import { DownloadOutlined, FilePdfOutlined, MinusCircleOutlined, PlusOutlined, PrinterOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, Modal, Progress, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { payrollApi } from "../api/payroll";
import { payrollOutputApi, saveFile } from "../api/payroll-output";
import type { BankColumn, BankField, BankTemplate, PaidResult, PaymentBatch, PaymentItem, PayslipList, PayslipView } from "../api/payroll-output";

const { Text, Paragraph } = Typography;
const money = (value: string | number) => Math.round(Number(value)).toLocaleString("vi-VN") + " đ";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const BATCH_STATUS: Record<PaymentBatch["status"], [string, string]> = { EXPORTED: ["Đã xuất file, chưa chi", "processing"], PAID: ["Đã chi", "success"], CANCELLED: ["Đã hủy", "default"] };
const FIELD_LABEL: Record<BankField, string> = { SEQ: "Số thứ tự", EMPLOYEE_CODE: "Mã nhân viên", BENEFICIARY_NAME: "Tên người hưởng", ACCOUNT_NUMBER: "Số tài khoản", BANK_CODE: "Mã ngân hàng", BANK_NAME: "Tên ngân hàng", BRANCH: "Chi nhánh", AMOUNT: "Số tiền (thực lĩnh)", DESCRIPTION: "Nội dung chuyển khoản", SITE_CODE: "Mã cơ sở", PERIOD_CODE: "Mã kỳ lương" };
const RULE_LABEL: Record<string, string> = { EMPLOYEE_CODE: "mã nhân viên", ID_LAST4: "4 số cuối giấy tờ", ID_LAST6: "6 số cuối giấy tờ", DOB_DDMMYYYY: "ngày sinh ddmmyyyy", DOB_DDMM: "ngày sinh ddmm", DOB_YYYY: "năm sinh" };

/** Locked periods only: every output is built from the locked snapshot. */
function useLockedSheets() {
  const periods = useQuery({ queryKey: ["payroll-periods"], queryFn: payrollApi.periods });
  return { ...periods, items: (periods.data?.items ?? []).filter(item => item.sheet?.status === "LOCKED") };
}

const escape = (value: string) => value.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
function printPayslip(view: PayslipView) {
  const rows = view.sections.filter(section => section.rows.length).map(section => `<h3>${escape(section.title)}</h3><table>${section.rows.map(row => `<tr><td>${escape(row.label)}${row.detail ? ` <small>(${escape(row.detail)})</small>` : ""}</td><td class="n">${money(row.amount)}</td></tr>`).join("")}${section.total !== null && section.rows.length > 1 ? `<tr class="t"><td>Cộng</td><td class="n">${money(section.total)}</td></tr>` : ""}</table>`).join("");
  const units = view.units.map(unit => `<li>${escape(unit.orgUnit)}: ${unit.from} → ${unit.to} — ${unit.workUnits} công</li>`).join("");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu lương ${escape(view.employee.code)}</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;font-size:13px}h1{text-align:center;font-size:20px;margin:8px 0}h3{margin:14px 0 4px;font-size:14px}table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px solid #eee}.n{text-align:right;white-space:nowrap}.t td{font-weight:600}.net{font-size:16px;font-weight:700;display:flex;justify-content:space-between;border-top:2px solid #000;margin-top:12px;padding-top:6px}small,.f{color:#555}.f{font-size:10px;margin-top:16px;word-break:break-all}</style></head><body><div><strong>${escape(view.companyName)}</strong><br>${escape(view.siteName)}</div><h1>PHIẾU LƯƠNG</h1><p style="text-align:center">Kỳ ${escape(view.period.code)}: ${view.period.dateFrom} → ${view.period.dateTo}</p><p><strong>Người lao động:</strong> ${escape(view.employee.fullName)} (${escape(view.employee.code)})</p>${units ? `<p><strong>Đơn vị và số công:</strong></p><ul>${units}</ul>` : ""}${rows}<div class="net"><span>THỰC LĨNH</span><span>${money(view.net)}</span></div><p class="f">Dựng từ bảng lương đã khóa · mã băm snapshot ${view.snapshotHash}</p></body></html>`;
  const target = window.open("", "_blank", "width=820,height=900");
  if (!target) return false;
  target.document.write(html); target.document.close(); target.focus(); target.print();
  return true;
}

function ExportProgress({ id, onDone }: { id: string; onDone: () => void }) {
  const { message } = App.useApp();
  const status = useQuery({ queryKey: ["payslip-export", id], queryFn: () => payrollOutputApi.exportStatus(id), refetchInterval: query => query.state.data?.export.status === "RUNNING" ? 1000 : false });
  const download = useMutation({ mutationFn: () => payrollOutputApi.downloadExport(id), onSuccess: file => { saveFile(file); onDone(); }, onError: error => message.error(errorMessage(error)) });
  const job = status.data?.export;
  if (!job) return null;
  return <Alert type={job.status === "FAILED" ? "error" : job.status === "RUNNING" ? "info" : "success"} showIcon
    message={<Space wrap>{job.status === "RUNNING" ? "Đang tạo phiếu lương" : job.status === "COMPLETED" ? "Gói phiếu lương sẵn sàng" : job.status === "DOWNLOADED" ? "Đã tải gói phiếu lương" : job.status === "EXPIRED" ? "Gói đã hết hạn" : "Xuất thất bại"}<Progress percent={job.progressTotal ? Math.round(job.progressDone * 100 / job.progressTotal) : 100} size="small" style={{ width: 160 }} />{job.errorCount > 0 && <Tag color="error">{job.errorCount} tệp lỗi</Tag>}</Space>}
    description={<div className="tab-stack">
      {job.failure && <Text type="danger">{job.failure}</Text>}
      {status.data!.errors.length > 0 && <ul className="plain-list">{status.data!.errors.map(error => <li key={error.employee.code}>{error.employee.code} {error.employee.fullName}: {error.message}</li>)}</ul>}
      {job.status === "COMPLETED" && <Space wrap><Button type="primary" icon={<DownloadOutlined />} loading={download.isPending} onClick={() => download.mutate()}>Tải gói phiếu lương (chỉ một lần)</Button><Text type="secondary">Hết hạn {job.expiresAt && new Date(job.expiresAt).toLocaleString("vi-VN")}</Text></Space>}
    </div>} />;
}

export function PayslipsPanel() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const sheets = useLockedSheets();
  const [sheetId, setSheetId] = useState<string>();
  const [exportId, setExportId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["payslips", sheetId], queryFn: () => payrollOutputApi.payslips(sheetId!), enabled: Boolean(sheetId) });
  const refresh = () => void client.invalidateQueries({ queryKey: ["payslips", sheetId] });
  const start = useMutation({ mutationFn: () => payrollOutputApi.startExport(sheetId!), onSuccess: ({ export: job }) => { setExportId(job.id); refresh(); } });
  const pdf = useMutation({ mutationFn: (employeeId: string) => payrollOutputApi.payslipPdf(sheetId!, employeeId), onSuccess: file => { saveFile(file); refresh(); }, onError: error => message.error(errorMessage(error)) });
  const print = useMutation({ mutationFn: (employeeId: string) => payrollOutputApi.payslip(sheetId!, employeeId), onSuccess: ({ payslip }) => { if (!printPayslip(payslip)) message.warning("Trình duyệt chặn cửa sổ in; cho phép cửa sổ bật lên rồi thử lại."); refresh(); }, onError: error => message.error(errorMessage(error)) });
  const rule = list.data?.passwordRule?.value.split("+").map(token => RULE_LABEL[token] ?? token).join(" + ");
  const running = list.data?.exports.find(item => item.status === "RUNNING" || item.status === "COMPLETED");
  return <div className="tab-stack">
    <div className="workspace-filters">
      <label>Kỳ lương đã khóa<Select style={{ minWidth: 320 }} value={sheetId} placeholder="Chọn kỳ lương đã khóa" loading={sheets.isLoading} onChange={value => { setSheetId(value); setExportId(null); }} options={sheets.items.map(item => ({ value: item.sheet!.id, label: `${item.code} — ${item.siteName}` }))} notFoundContent="Chưa có kỳ lương đã khóa" /></label>
      {sheetId && <Button type="primary" icon={<FilePdfOutlined />} loading={start.isPending} disabled={list.data?.exports.some(item => item.status === "RUNNING")} onClick={() => start.mutate()}>Xuất phiếu lương toàn cơ sở</Button>}
    </div>
    <Alert type="info" showIcon message="Phiếu lương chỉ dựng từ bảng lương đã khóa" description={<>Mỗi người một tệp PDF đặt mật khẩu mở tệp (AES-256){rule ? <> theo quy tắc: <strong>{rule}</strong></> : null}. Hệ thống không lưu mật khẩu; thông báo quy tắc cho nhân viên qua kênh khác với kênh gửi tệp. Mọi lần xuất, in đều ghi nhật ký.</>} />
    {start.isError && <Alert type="error" showIcon message="Không xuất được" description={errorMessage(start.error)} />}
    {(exportId ?? running?.id) && <ExportProgress key={exportId ?? running!.id} id={(exportId ?? running?.id)!} onDone={refresh} />}
    {!sheetId ? <Empty description="Chọn kỳ lương đã khóa" /> : list.isError ? <Alert type="error" showIcon message={errorMessage(list.error)} /> :
      <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh sách phiếu lương; dùng phím mũi tên để cuộn"><Table<PayslipList["items"][number]>     rowKey="employeeId" loading={list.isLoading} dataSource={list.data?.items ?? []} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 760 }} columns={[
        { title: "Nhân sự", render: (_, row) => <>{row.code}<br /><Text type="secondary">{row.fullName}</Text></>, width: 220 },
        { title: "Thực lĩnh", dataIndex: "net", align: "right", render: money },
        { title: "Đã phát hành", width: 170, render: (_, row) => row.issuedCount ? <>{row.issuedCount} lần<br /><Text type="secondary">{row.lastIssuedAt && new Date(row.lastIssuedAt).toLocaleString("vi-VN")}</Text></> : <Text type="secondary">Chưa</Text> },
        { title: "Lỗi", dataIndex: "failedCount", width: 70, render: (value: number) => value ? <Tag color="error">{value}</Tag> : "—" },
        { title: "", width: 210, render: (_, row) => <Space wrap><Button size="small" icon={<PrinterOutlined />} loading={print.isPending && print.variables === row.employeeId} onClick={() => print.mutate(row.employeeId)}>Bản in</Button><Button size="small" icon={<DownloadOutlined />} loading={pdf.isPending && pdf.variables === row.employeeId} onClick={() => pdf.mutate(row.employeeId)}>PDF</Button></Space> },
      ]} /></section>}
  </div>;
}

/** Re-entered password (NFR-33) shared by creating a batch and downloading its file. */
function useReauth() {
  const [token, setToken] = useState<{ value: string; until: number } | null>(null);
  return { valid: () => token && token.until > Date.now() + 15_000 ? token.value : null, get: async (password: string) => { const result = await payrollApi.reauthenticate(password); setToken({ value: result.token, until: Date.parse(result.expiresAt) }); return result.token; } };
}

function BatchDrawer({ id, onClose, reauth }: { id: string; onClose: () => void; reauth: ReturnType<typeof useReauth> }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const detail = useQuery({ queryKey: ["payment-batch", id], queryFn: () => payrollOutputApi.batch(id) });
  const [dialog, setDialog] = useState<"paid" | "cancel" | "file" | null>(null);
  const [paidDate, setPaidDate] = useState(today());
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<PaidResult | null>(null);
  const close = () => { setDialog(null); setText(""); setPassword(""); };
  const refresh = () => { void client.invalidateQueries({ queryKey: ["payment-batch", id] }); void client.invalidateQueries({ queryKey: ["payment-batches"] }); };
  const batch = detail.data?.batch;
  const action = useMutation({
    mutationFn: async () => {
      if (dialog === "paid") { const response = await payrollOutputApi.markPaid(id, { paidDate, revision: batch!.revision, note: text.trim() || undefined }); setResult(response.result); return; }
      if (dialog === "cancel") { await payrollOutputApi.cancel(id, { revision: batch!.revision, reason: text.trim() }); return; }
      saveFile(await payrollOutputApi.batchFile(id, reauth.valid() ?? await reauth.get(password)));
    },
    onSuccess: () => { close(); refresh(); },
    onError: () => setPassword(""),
  });
  const download = () => { const token = reauth.valid(); if (!token) { setDialog("file"); return; } payrollOutputApi.batchFile(id, token).then(saveFile, error => message.error(errorMessage(error))); };
  return <Drawer open width={860} title={batch ? `Lô chi ${batch.code}` : "Lô chi lương"} onClose={onClose}>
    {detail.isError && <Alert type="error" showIcon message={errorMessage(detail.error)} />}
    {batch && <div className="tab-stack">
      <Descriptions size="small" bordered column={2} items={[
        { key: "status", label: "Trạng thái", children: <Tag color={BATCH_STATUS[batch.status][1]}>{BATCH_STATUS[batch.status][0]}</Tag> },
        { key: "bank", label: "Mẫu", children: `${batch.template.bankName} v${batch.template.version} (${batch.template.fileType})` },
        { key: "total", label: "Tổng chi", children: <strong>{money(batch.total)}</strong> }, { key: "count", label: "Số người", children: batch.itemCount },
        { key: "due", label: "Hạn chi", children: batch.dueDate }, { key: "paid", label: "Ngày chi thực tế", children: batch.paidDate ? `${batch.paidDate}${batch.lateDays && batch.lateDays > 0 ? ` (chậm ${batch.lateDays} ngày)` : ""}` : "—" },
        { key: "hash", label: "Mã băm nội dung", span: 2, children: <Text code>{batch.contentHash}</Text> },
      ]} />
      <Space wrap>
        {batch.status !== "CANCELLED" && <Button icon={<DownloadOutlined />} onClick={download}>Tải file chi</Button>}
        {batch.status === "EXPORTED" && <Button type="primary" onClick={() => setDialog("paid")}>Ghi ngày chi thực tế</Button>}
        {batch.status === "EXPORTED" && <Button danger onClick={() => setDialog("cancel")}>Hủy lô</Button>}
      </Space>
      {batch.status === "EXPORTED" && <Alert type="warning" showIcon message="Xuất file chưa phải đã thanh toán" description="Sau khi ngân hàng chuyển tiền, ghi ngày chi thực tế để cập nhật sổ thuế và tính đền bù nếu chậm quá 15 ngày." />}
      {result && <Alert type={result.compensations.length ? "warning" : result.lateWarning ? "info" : "success"} showIcon closable onClose={() => setResult(null)} message={result.compensations.length ? `Chậm ${result.lateDays} ngày: phát sinh ${result.compensations.length} khoản đền bù vào kỳ lương mở kế tiếp` : result.lateWarning ?? "Đã ghi nhận ngày chi thực tế"}
        description={<>{result.compensations.length > 0 && <ul className="plain-list">{result.compensations.map(row => <li key={row.employee.code}>{row.employee.code} {row.employee.fullName}: {money(row.amount)}</li>)}</ul>}{result.taxContextChanged.length > 0 && <p>Năm thuế của ngày chi thực tế khác ngày dự kiến ({result.taxContextChanged.length} bản ghi thuế đánh dấu TAX_CONTEXT_CHANGED); xử lý bằng điều chỉnh, bảng lương đã khóa giữ nguyên.</p>}</>} />}
      <section className="workspace-table" role="region" tabIndex={0} aria-label="Chi tiết lô chi lương; dùng phím mũi tên để cuộn"><Table<PaymentItem>     size="small" rowKey="id" pagination={false} dataSource={detail.data!.items} scroll={{ x: 760 }} columns={[
        { title: "Nhân sự", render: (_, row) => <>{row.employee.code}<br /><Text type="secondary">{row.employee.fullName}</Text></> },
        { title: "Kỳ", dataIndex: "periodCode" }, { title: "Tài khoản", render: (_, row) => `${row.bank} ${row.accountMasked}` },
        { title: "Số tiền", dataIndex: "amount", align: "right", render: money },
        { title: "Đền bù chậm trả", render: (_, row) => row.compensation ? <>{money(row.compensation.amount)}<br /><Text type="secondary">{row.compensation.appliedPeriodId ? "Đã vào kỳ lương" : "Chờ kỳ lương mở"}</Text></> : "—" },
      ]} /></section>
    </div>}
    <Modal open={dialog === "paid"} title="Ghi ngày chi thực tế" okText="Ghi nhận" okButtonProps={{ disabled: !paidDate, loading: action.isPending }} onOk={() => action.mutate()} onCancel={close}>
      <div className="tab-stack"><label>Ngày ngân hàng chuyển tiền<Input type="date" value={paidDate} max={today()} onChange={event => setPaidDate(event.target.value)} /></label><Input.TextArea rows={2} value={text} maxLength={2000} onChange={event => setText(event.target.value)} placeholder="Ghi chú / số chứng từ ngân hàng (không bắt buộc)" /></div>
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    </Modal>
    <Modal open={dialog === "cancel"} title="Hủy lô chi" okText="Hủy lô" okButtonProps={{ danger: true, disabled: !text.trim(), loading: action.isPending }} onOk={() => action.mutate()} onCancel={close}>
      <Input.TextArea rows={3} value={text} maxLength={2000} onChange={event => setText(event.target.value)} placeholder="Lý do hủy (lô hủy không tải lại file; nhân viên được đưa vào lô mới)" />
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    </Modal>
    <Modal open={dialog === "file"} title="Nhập lại mật khẩu để tải file chi" okText="Tải file" okButtonProps={{ disabled: !password, loading: action.isPending }} onOk={() => action.mutate()} onCancel={close}>
      <Input.Password autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} onPressEnter={() => password && action.mutate()} />
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    </Modal>
  </Drawer>;
}

export function PaymentBatchesPanel() {
  const client = useQueryClient();
  const reauth = useReauth();
  const sheets = useLockedSheets();
  const batches = useQuery({ queryKey: ["payment-batches"], queryFn: payrollOutputApi.batches });
  const templates = useQuery({ queryKey: ["bank-templates"], queryFn: payrollOutputApi.templates });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ sheetIds: string[]; templateId?: string; note: string; password: string }>({ sheetIds: [], note: "", password: "" });
  const create = useMutation({
    mutationFn: async () => {
      const token = reauth.valid() ?? await reauth.get(form.password);
      const created = await payrollOutputApi.createBatch({ sheetIds: form.sheetIds, templateId: form.templateId!, reauthToken: token, note: form.note.trim() || undefined });
      saveFile(await payrollOutputApi.batchFile(created.batch.id, token));
      return created;
    },
    onSuccess: created => { setCreating(false); setForm({ sheetIds: [], note: "", password: "" }); setOpen(created.batch.id); void client.invalidateQueries({ queryKey: ["payment-batches"] }); },
    onError: () => setForm(current => ({ ...current, password: "" })),
  });
  const current = (templates.data?.items ?? []).filter(item => item.current && item.active);
  return <div className="tab-stack">
    <div className="workspace-filters"><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Xuất file chi lương</Button></div>
    <Paragraph type="secondary">File chi ghi đúng thực lĩnh từng người; phí chuyển khoản do doanh nghiệp chịu. Mỗi nhân viên của một kỳ chỉ thuộc một lô chi hiệu lực.</Paragraph>
    {batches.isError && <Alert type="error" showIcon message={errorMessage(batches.error)} />}
    <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh sách lô chi lương; dùng phím mũi tên để cuộn"><Table<PaymentBatch>     rowKey="id" loading={batches.isLoading} dataSource={batches.data?.items ?? []} scroll={{ x: 900 }} onRow={row => ({ onClick: () => setOpen(row.id) })} columns={[
      { title: "Mã lô", dataIndex: "code", width: 180 }, { title: "Kỳ lương", dataIndex: "periods", render: (value: string[]) => value.join(", ") },
      { title: "Mẫu", render: (_, row) => `${row.template.bankName} v${row.template.version}` }, { title: "Số người", dataIndex: "itemCount", align: "right", width: 90 },
      { title: "Tổng chi", dataIndex: "total", align: "right", render: money }, { title: "Hạn chi", dataIndex: "dueDate", width: 110 },
      { title: "Trạng thái", dataIndex: "status", width: 190, render: (value: PaymentBatch["status"], row) => <><Tag color={BATCH_STATUS[value][1]}>{BATCH_STATUS[value][0]}</Tag>{row.paidDate && <Text type={row.lateDays && row.lateDays > 0 ? "warning" : "secondary"}>{row.paidDate}{row.lateDays && row.lateDays > 0 ? ` · chậm ${row.lateDays} ngày` : ""}</Text>}</> },
    ]} /></section>
    {open && <BatchDrawer id={open} reauth={reauth} onClose={() => setOpen(null)} />}
    <Modal open={creating} width={620} title="Xuất file chi lương" okText="Xác nhận và tải file" okButtonProps={{ disabled: !form.sheetIds.length || !form.templateId || (!reauth.valid() && !form.password), loading: create.isPending }} onOk={() => create.mutate()} onCancel={() => setCreating(false)} destroyOnClose>
      <div className="tab-stack">
        <label>Bảng lương đã khóa<Select mode="multiple" value={form.sheetIds} onChange={sheetIds => setForm(current => ({ ...current, sheetIds }))} placeholder="Chọn một hoặc nhiều kỳ" options={sheets.items.map(item => ({ value: item.sheet!.id, label: `${item.code} — ${item.siteName} (chi ${item.expectedPaymentDate ?? "?"})` }))} /></label>
        <label>Mẫu ngân hàng<Select value={form.templateId} onChange={templateId => setForm(current => ({ ...current, templateId }))} placeholder="Chọn mẫu hiện hành" options={current.map(item => ({ value: item.id, label: `${item.bankName} v${item.version} — ${item.name} (${item.fileType}${item.splitBySite ? ", tách theo cơ sở" : ""})` }))} /></label>
        <Input.TextArea rows={2} value={form.note} maxLength={2000} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="Ghi chú (không bắt buộc)" />
        {!reauth.valid() && <label>Nhập lại mật khẩu để xác nhận<Input.Password autoComplete="current-password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} /></label>}
        {create.isError && <Alert type="error" showIcon message={errorMessage(create.error)} />}
      </div>
    </Modal>
  </div>;
}

export function BankTemplatesPanel() {
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ["bank-templates"], queryFn: payrollOutputApi.templates });
  const [editing, setEditing] = useState<Partial<BankTemplate> | null>(null);
  const [form] = Form.useForm<{ bankCode: string; name: string; fileType: "CSV" | "XLSX"; columns: BankColumn[]; splitBySite: boolean; includeHeader: boolean; active: boolean; status: "SIMULATION" | "BUSINESS_CONFIRMED"; reason: string }>();
  const save = useMutation({ mutationFn: payrollOutputApi.createTemplate, onSuccess: () => { setEditing(null); void client.invalidateQueries({ queryKey: ["bank-templates"] }); } });
  const openEditor = (base?: BankTemplate) => { setEditing(base ?? {}); form.setFieldsValue(base ? { bankCode: base.bankCode, name: base.name, fileType: base.fileType, columns: base.columns, splitBySite: base.splitBySite, includeHeader: base.includeHeader, active: base.active, status: "SIMULATION", reason: "" } : { fileType: "XLSX", columns: [{ field: "SEQ", header: "STT" }, { field: "ACCOUNT_NUMBER", header: "So tai khoan" }, { field: "BENEFICIARY_NAME", header: "Ten nguoi huong", format: "UPPER_ASCII" }, { field: "AMOUNT", header: "So tien", format: "INTEGER" }, { field: "DESCRIPTION", header: "Noi dung", format: "UPPER_ASCII" }], splitBySite: false, includeHeader: true, active: true, status: "SIMULATION" }); };
  return <div className="tab-stack">
    <div className="workspace-filters"><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>Thêm mẫu ngân hàng</Button></div>
    <Paragraph type="secondary">Mẫu file chi là cấu hình: thêm ngân hàng hoặc đổi bố cục bằng phiên bản mới, không cần sửa phần mềm. Lô chi đã xuất giữ nguyên mẫu đã dùng.</Paragraph>
    <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh sách mẫu file ngân hàng; dùng phím mũi tên để cuộn"><Table<BankTemplate>     rowKey="id" loading={templates.isLoading} dataSource={templates.data?.items ?? []} scroll={{ x: 900 }} columns={[
      { title: "Ngân hàng", render: (_, row) => <>{row.bankName} v{row.version}{row.current && <Tag color="blue" style={{ marginLeft: 6 }}>Hiện hành</Tag>}</>, width: 200 },
      { title: "Tên mẫu", dataIndex: "name" }, { title: "Loại", dataIndex: "fileType", width: 70 },
      { title: "Cột", render: (_, row) => row.columns.map(column => column.header).join(" · ") },
      { title: "Tách cơ sở", dataIndex: "splitBySite", width: 100, render: value => value ? "Có" : "Không" },
      { title: "Trạng thái", width: 150, render: (_, row) => <><Tag color={row.active ? "success" : "default"}>{row.active ? "Hoạt động" : "Ngừng"}</Tag>{row.status === "SIMULATION" && <Tag color="orange">Mô phỏng</Tag>}</> },
      { title: "", width: 120, render: (_, row) => row.current && <Button size="small" onClick={() => openEditor(row)}>Phiên bản mới</Button> },
    ]} /></section>
    <Modal open={Boolean(editing)} width={760} title={editing?.bankCode ? `Phiên bản mới — ${editing.bankName}` : "Thêm mẫu ngân hàng"} okText="Lưu phiên bản" confirmLoading={save.isPending} onOk={() => form.submit()} onCancel={() => setEditing(null)} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={values => save.mutate({ ...values, columns: values.columns.map(column => ({ field: column.field, header: column.header, ...(column.format ? { format: column.format } : {}) })) })}>
        <Space wrap align="start">
          <Form.Item name="bankCode" label="Ngân hàng" rules={[{ required: true, message: "Chọn ngân hàng." }]}><Select style={{ width: 220 }} disabled={Boolean(editing?.bankCode)} options={(templates.data?.banks ?? []).map(bank => ({ value: bank.code, label: `${bank.shortName} (${bank.code})` }))} /></Form.Item>
          <Form.Item name="fileType" label="Loại tệp"><Select style={{ width: 110 }} options={[{ value: "XLSX", label: "Excel" }, { value: "CSV", label: "CSV" }]} /></Form.Item>
          <Form.Item name="status" label="Trạng thái dữ liệu"><Select style={{ width: 200 }} options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Doanh nghiệp xác nhận" }]} /></Form.Item>
        </Space>
        <Form.Item name="name" label="Tên mẫu" rules={[{ required: true, whitespace: true, message: "Nhập tên mẫu." }]}><Input maxLength={200} /></Form.Item>
        <Space wrap><Form.Item name="splitBySite" valuePropName="checked"><Checkbox>Tách file theo cơ sở</Checkbox></Form.Item><Form.Item name="includeHeader" valuePropName="checked"><Checkbox>Có dòng tiêu đề</Checkbox></Form.Item><Form.Item name="active" valuePropName="checked"><Checkbox>Đang dùng</Checkbox></Form.Item></Space>
        <Form.List name="columns">{(fields, { add, remove, move }) => <div className="tab-stack">
          <Text strong>Cột theo thứ tự (bắt buộc có Số tài khoản và Số tiền)</Text>
          {fields.map((field, index) => <Space key={field.key} align="baseline" wrap>
            <Form.Item name={[field.name, "field"]} rules={[{ required: true, message: "Chọn trường." }]}><Select style={{ width: 210 }} options={Object.entries(FIELD_LABEL).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item name={[field.name, "header"]} rules={[{ required: true, whitespace: true, message: "Nhập tiêu đề." }]}><Input style={{ width: 180 }} placeholder="Tiêu đề cột" maxLength={100} /></Form.Item>
            <Form.Item name={[field.name, "format"]}><Select allowClear style={{ width: 170 }} placeholder="Định dạng" options={[{ value: "TEXT", label: "Giữ nguyên" }, { value: "UPPER_ASCII", label: "IN HOA không dấu" }, { value: "INTEGER", label: "Số nguyên" }, { value: "DECIMAL2", label: "Số 2 chữ số lẻ" }]} /></Form.Item>
            <Button size="small" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label="Lên">↑</Button>
            <Button size="small" type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} aria-label="Xóa cột" />
          </Space>)}
          <Button icon={<PlusOutlined />} onClick={() => add({ field: "EMPLOYEE_CODE", header: "Ma NV" })}>Thêm cột</Button>
        </div>}</Form.List>
        <Form.Item name="reason" label="Lý do / căn cứ" rules={[{ required: true, whitespace: true, message: "Nhập lý do." }]} style={{ marginTop: 12 }}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
        {save.isError && <Alert type="error" showIcon message={errorMessage(save.error)} />}
      </Form>
    </Modal>
  </div>;
}
