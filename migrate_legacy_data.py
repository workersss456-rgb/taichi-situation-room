import openpyxl
from datetime import datetime, date

SRC = '/mnt/user-data/uploads/戰情表資料庫.xlsx'
wb = openpyxl.load_workbook(SRC, data_only=True)

def sql_str(v):
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def sql_num(v):
    if v is None or v == '':
        return 'NULL'
    try:
        return str(float(v))
    except Exception:
        return 'NULL'

# 舊 pid (p1..p15) -> 新 案場ID（用 P1001~ 避免跟現有 P0001~P0008 撞號）
old_ids = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10','p11','p12','p13','p14','p15']
id_map = {old: f'P{1000+i+1}' for i, old in enumerate(old_ids)}

def roc_to_western_ym(s):
    # "114/12" -> "2025-12"
    s = str(s).strip()
    if '/' not in s:
        return None
    y, m = s.split('/')
    y = int(y) + 1911
    return f"{y:04d}-{int(m):02d}"

out = []
out.append("-- =====================================================================")
out.append("-- 太綺戰情室 — 舊版資料匯入（案場 / 月度紀錄 / 追加減 分頁）")
out.append("-- ⚠️ 這份先不要直接執行！")
out.append("-- 這些是「舊版戰情表」用小寫 p1~p15 記錄的 15 個案場，")
out.append("-- 跟目前新格式裡已經存在、但主檔資料是空的 P0001~P0008 案場，")
out.append("-- 「有沒有重複」需要你確認過一次才能匯入，否則可能會讓營收/支出被重複計算。")
out.append("-- 對照表如下（新 ID 先暫訂為 P1001~P1015，避免跟 P0001~P0008 撞號）：")
for old, new in id_map.items():
    out.append(f"--   {old} -> {new}")
out.append("-- 確認「哪些是全新案場、哪些其實跟 P0001~P0008 是同一個案場」之後，")
out.append("-- 請把下面對應的 P100x 改成正確的 P000x，或是把重複的整段刪掉，再執行。")
out.append("-- =====================================================================")
out.append("BEGIN;")
out.append("")

# 案場主檔
out.append("-- 1) 案場主檔（舊資料，含稅金額直接沿用「contract」欄位）")
ws = wb['案場']
projects = {}
for r in ws.iter_rows(min_row=2, values_only=True):
    pid, name, owner, contract, extra, manual_base, archived = r
    if not pid:
        continue
    projects[pid] = {'name': name, 'owner': owner, 'contract': contract or 0}
    new_id = id_map[pid]
    incl = float(contract or 0)
    untax = round(incl / 1.05)
    tax = incl - untax
    status = '結案' if archived else '進行中'
    out.append(
        f"INSERT INTO \"案場主檔\"(\"案場ID\",\"案場名稱\",\"業主\",\"主約未稅金額\",\"主約稅額\",\"主約含稅金額\",\"狀態\",\"備註\") VALUES "
        f"({sql_str(new_id)}, {sql_str(name)}, {sql_str(owner)}, {sql_num(untax)}, {sql_num(tax)}, {sql_num(incl)}, {sql_str(status)}, "
        f"{sql_str('舊戰情表匯入（原始 ID: ' + pid + '）。未稅/稅額為系統以稅率5%反推估計值，請核對正確金額。')}) "
        f"ON CONFLICT (\"案場ID\") DO NOTHING;"
    )
out.append("")

# 合約明細（追加減）
out.append("-- 2) 合約明細（追加減，正數=追加，負數=追減）")
ws = wb['追加減']
seq_counter = {}
for r in ws.iter_rows(min_row=2, values_only=True):
    pid, cid, name, amount = r
    if not pid:
        continue
    new_pid = id_map[pid]
    seq_counter[new_pid] = seq_counter.get(new_pid, 0) + 1
    seq = seq_counter[new_pid]
    detail_id = f"C{new_pid[1:]}-{seq:02d}"
    amt = float(amount or 0)
    out.append(
        f"INSERT INTO \"合約明細\"(\"明細ID\",\"案場ID\",\"類型\",\"序號\",\"項目名稱\",\"未稅金額\",\"稅額\",\"含稅金額\",\"備註\") VALUES "
        f"({sql_str(detail_id)}, {sql_str(new_pid)}, '追加', {seq}, {sql_str(name)}, {sql_num(amt)}, 0, {sql_num(amt)}, "
        f"{sql_str('舊戰情表匯入（原始 ID: ' + str(cid) + '）')}) "
        f"ON CONFLICT (\"明細ID\") DO NOTHING;"
    )
out.append("")

# 月度請款（用 targetBilling 當預估請款金額；實際請款是用發票登記算的，
# 所以另外把 actualBilling 生成一筆「歷史匯入」發票，讓達成率看得出來）
out.append("-- 3) 月度請款（預估請款金額 = 舊資料的 targetBilling）")
out.append("-- 4) 發票登記（用舊資料的 actualBilling 生一筆「歷史資料」發票，讓歷史達成率算得出來）")
ws = wb['月度紀錄']
b_counter = {}
i_counter = {}
for r in ws.iter_rows(min_row=2, values_only=True):
    (pid, ym, target, actual, subP, subA, matP, matA, otherP, otherA,
     laborP, laborA, outP, outA, drawing, note) = r
    if not pid:
        continue
    new_pid = id_map[pid]
    ym_w = roc_to_western_ym(ym)
    if not ym_w:
        continue
    b_counter[new_pid] = b_counter.get(new_pid, 0) + 1
    bid = f"B{new_pid[1:]}-{b_counter[new_pid]:02d}"
    memo_bits = []
    if subA: memo_bits.append(f"發包實際{subA}")
    if matA: memo_bits.append(f"材料實支{matA}")
    if laborA: memo_bits.append(f"點工天數{laborA}")
    if outA: memo_bits.append(f"外包天數{outA}")
    if note: memo_bits.append(str(note))
    memo = '舊戰情表匯入。' + '；'.join(str(m) for m in memo_bits) if memo_bits else '舊戰情表匯入'
    out.append(
        f"INSERT INTO \"月度請款\"(\"請款ID\",\"案場ID\",\"年月\",\"預估請款金額\",\"備註\") VALUES "
        f"({sql_str(bid)}, {sql_str(new_pid)}, {sql_str(ym_w)}, {sql_num(target)}, {sql_str(memo)}) "
        f"ON CONFLICT (\"請款ID\") DO NOTHING;"
    )
    if actual:
        i_counter[new_pid] = i_counter.get(new_pid, 0) + 1
        iid = f"I{new_pid[1:]}-{i_counter[new_pid]:02d}"
        y, m = map(int, ym_w.split('-'))
        last_day = 28
        for d in (31, 30, 29, 28):
            try:
                date(y, m, d)
                last_day = d
                break
            except ValueError:
                continue
        out.append(
            f"INSERT INTO \"發票登記\"(\"發票ID\",\"案場ID\",\"類型\",\"發票日期\",\"項目\",\"金額(含稅)\",\"備註\") VALUES "
            f"({sql_str(iid)}, {sql_str(new_pid)}, '三聯發票', {sql_str(f'{y:04d}-{m:02d}-{last_day:02d}')}, "
            f"{sql_str(str(ym) + ' 舊資料實際請款彙總')}, {sql_num(actual)}, "
            f"{sql_str('⚠️ 舊戰情表匯入的彙總數字，不是真正的單張發票，僅供歷史達成率參考')}) "
            f"ON CONFLICT (\"發票ID\") DO NOTHING;"
        )
out.append("")
out.append("COMMIT;")

with open('/home/claude/taichi/database/seed_legacy_PENDING_REVIEW.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

print('done, lines:', len(out))
print('projects found:', list(projects.keys()))
