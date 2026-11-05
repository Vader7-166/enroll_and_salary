import { CheckCircleOutlined, FilePdfOutlined, LoadingOutlined, LockOutlined, PlayCircleOutlined, RollbackOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Empty, Input, Modal, Progress, Select, Space, Spin, Statistic, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { payrollApi } from "../api/payroll";
import type { ComplianceItem, PayrollPeriodItem, PayrollRunView, SheetEmployee, SheetHistoryItem, SheetView } from "../api/payroll";
import { TechnicalDetails } from "./TechnicalDetails";
import { BusinessIllustration } from "./BusinessIllustration";

const { Title, Text } = Typography;
const money = (value: string | number) => Number(value).toLocaleString("vi-VN") + " đ";
const SHEET_STATUS: Record<string, [string, string]> = { DRAFT: ["Nháp", "default"], APPROVED: ["Đã duyệt", "success"], LOCKED: ["Đã khóa", "default"] };
const ACTION_LABEL: Record<string, string> = { APPROVE: "Duyệt", LOCK: "Khóa kỳ lương", RETURN_TO_DRAFT: "Trả về nháp", AUTO_DRAFT: "Tự về nháp do nguồn đổi" };
const RUN_LABEL: Record<PayrollRunView["status"], string> = { RUNNING: "Đang tính lương", COMPLETED: "Hoàn tất", FAILED: "Không hoàn tất", CANCELLED: "Đã dừng" };
const dueText = (period: Pick<PayrollPeriodItem, "dueWarning" | "expectedPaymentDate">) => !period.dueWarning ? "" : period.dueWarning.overdue ? `quá hạn chi ${-period.dueWarning.daysLeft} ngày` : `còn ${period.dueWarning.daysLeft} ngày đến hạn chi`;
function saveBlob(blob: Blob, name: string) { const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.click(); URL.revokeObjectURL(href); }
const CP_LABEL: Record<string, string> = { "CP-01": "Dưới lương tối thiểu vùng", "CP-02": "Thử việc dưới 85%", "CP-03": "Vượt trần OT", "CP-04": "Khấu trừ vượt 30%", "CP-05": "Thực lĩnh âm", "CP-06": "Còn ngày công lỗi", "CP-07": "Thiếu lương đóng BH", "CP-08": "Chênh lệch kỳ trước", "CP-09": "Lương sản phẩm dưới tối thiểu", TAX_EXCEPTION: "Ngoại lệ miễn thuế" };

function TraceDrawer({ lineId, onClose }: { lineId: string; onClose: () => void }) {
  const trace = useQuery({ queryKey: ["payroll-trace", lineId], queryFn: () => payrollApi.trace(lineId) });
  return <Drawer open title="Giải trình dòng lương" width={720} onClose={onClose}>
    {trace.isError && <Alert type="error" showIcon message="Không mở được giải trình" description={errorMessage(trace.error)} />}
    {trace.data && <div className="tab-stack">
      <Descriptions size="small" bordered column={1} items={[{ key: "line", label: trace.data.line.label, children: <strong>{money(trace.data.line.amount)}</strong> }, { key: "param", label: "Tham số/bộ quy tắc", children: trace.data.line.paramCode ?? "—" }]} />
      {"hourlyRate" in trace.data.trace && <Alert type="info" showIcon message={(() => { const rate = trace.data!.trace.hourlyRate as { numerator: string; denominatorHours: string; rate: string }; return `Đơn giá giờ = ${money(rate.numerator)} ÷ ${rate.denominatorHours} giờ = ${money(rate.rate)}`; })()} />}
      {Array.isArray(trace.data.trace.segments) && <Table size="small" rowKey="from" pagination={false} dataSource={trace.data.trace.segments as Array<{ from: string; to: string; rate: string; quantity: string; unit: string; amount: string; reference: string }>} columns={[{ title: "Đoạn", render: (_, row) => `${row.from} → ${row.to}` }, { title: "Mức", dataIndex: "rate", render: money }, { title: "Số lượng", render: (_, row) => `${row.quantity} ${row.unit}` }, { title: "Thành tiền", dataIndex: "amount", render: value => money(Math.round(Number(value))) }, { title: "Nguồn", dataIndex: "reference" }]} />}
      {Array.isArray(trace.data.trace.buckets) && <Table size="small" rowKey={(_, index) => String(index)} pagination={false} dataSource={trace.data.trace.buckets as Array<{ workDate: string; dayType: string; isNight: boolean; hours: string; rate: string; amount: string }>} columns={[{ title: "Ngày công", dataIndex: "workDate" }, { title: "Loại ngày", dataIndex: "dayType" }, { title: "Đêm", dataIndex: "isNight", render: value => value ? "Có" : "Không" }, { title: "Giờ", dataIndex: "hours" }, { title: "Hệ số", dataIndex: "rate", render: value => Number(value) * 100 + "%" }, { title: "Tiền", dataIndex: "amount", render: value => money(Math.round(Number(value))) }]} />}
      {trace.data.attendance.map(day => <Descriptions key={day.workDate} size="small" bordered column={1} title={"Công gốc " + day.workDate} items={[
        { key: "days", label: "Ca", children: day.days.map(item => `${item.checkInAt ?? "?"} → ${item.checkOutAt ?? "?"} (${item.workedMinutes} phút)`).join("; ") || "—" },
        { key: "punches", label: "Lượt quẹt", children: day.punches.map(punch => `${new Date(punch.punchedAt).toLocaleString("vi-VN")} ${punch.direction} (${punch.deviceCode})`).join("; ") || "—" },
      ]} />)}
      <Title level={5}>Nguồn đã dùng</Title>
      <Table size="small" rowKey={row => row.sourceType + row.sourceId} pagination={false} dataSource={trace.data.sources} columns={[{ title: "Loại", dataIndex: "sourceType" }, { title: "Mã", dataIndex: "sourceId", ellipsis: true }, { title: "Hash", dataIndex: "sourceHash", ellipsis: true }]} />
      <TechnicalDetails><pre>{JSON.stringify(trace.data.trace, null, 2)}</pre></TechnicalDetails>
    </div>}
  </Drawer>;
}

function EmployeeLines({ sheetId, employee, onClose }: { sheetId: string; employee: SheetEmployee; onClose: () => void }) {
  const [lineId, setLineId] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["payroll-employee", sheetId, employee.employee.id], queryFn: () => payrollApi.employee(sheetId, employee.employee.id) });
  return <Modal open title={`${employee.employee.code} — ${employee.employee.fullName}`} width={820} footer={null} onCancel={onClose}>
    {employee.errors.map(error => <Alert key={error.code} type="error" showIcon message={error.code} description={error.message} />)}
    {employee.violations.map(violation => <Alert key={violation.code + violation.message} type={violation.severity === "BLOCKING" ? "error" : "warning"} showIcon message={`${violation.code}: ${violation.message}`} />)}
    <div className="table-panel" role="region" tabIndex={0} aria-label="Chi tiết dòng lương; dùng phím mũi tên để cuộn">
      <Table size="small" rowKey="id" loading={detail.isLoading} pagination={false} dataSource={detail.data?.lines ?? []} scroll={{ x: 640 }} columns={[
        { title: "#", dataIndex: "lineNo", width: 50 }, { title: "Khoản", dataIndex: "label" }, { title: "Loại", dataIndex: "lineType", width: 150 },
        { title: "Số tiền", dataIndex: "amount", align: "right", render: money }, { title: "", width: 90, render: (_, row) => <Button size="small" type="link" onClick={() => setLineId(row.id)}>Giải trình</Button> },
      ]} />
    </div>
    {lineId && <TraceDrawer lineId={lineId} onClose={() => setLineId(null)} />}
  </Modal>;
}

function CompliancePanel({ sheetId, canCalculate, employees }: { sheetId: string; canCalculate: boolean; employees: SheetEmployee[] }) {
  const client = useQueryClient();
  const [ack, setAck] = useState<{ employeeId: string; reason: string } | null>(null);
  const compliance = useQuery({ queryKey: ["payroll-compliance", sheetId], queryFn: () => payrollApi.compliance(sheetId) });
  const acknowledge = useMutation({ mutationFn: () => payrollApi.acknowledge(sheetId, ack!.employeeId, ack!.reason), onSuccess: () => { setAck(null); void client.invalidateQueries({ queryKey: ["payroll-compliance", sheetId] }); } });
  const name = (id: string) => { const row = employees.find(item => item.employee.id === id); return row ? `${row.employee.code} ${row.employee.fullName}` : id; };
  return <section className="tab-stack" aria-label="Kiểm tra tuân thủ bảng lương">
    <div className="table-panel" role="region" tabIndex={0} aria-label="Bảng kiểm tra tuân thủ; dùng phím mũi tên để cuộn">
      <Table<ComplianceItem> size="small" rowKey="code" pagination={false} loading={compliance.isLoading} dataSource={compliance.data?.items ?? []} scroll={{ x: 620 }}
        expandable={{ rowExpandable: row => row.details.length > 0, expandedRowRender: row => <ul className="plain-list">{row.details.map(item => <li key={item.employeeId + item.message}>{name(item.employeeId)}: {item.message}{row.code === "CP-08" && (row.acknowledgements.some(a => a.employeeId === item.employeeId) ? <Tag color="success">Đã xác nhận</Tag> : canCalculate && <Button size="small" type="link" onClick={() => setAck({ employeeId: item.employeeId, reason: "" })}>Xác nhận</Button>)}</li>)}</ul> }}
        columns={[{ title: "Mã", dataIndex: "code", width: 120 }, { title: "Kiểm tra", render: (_, row) => CP_LABEL[row.code] ?? row.code }, { title: "Mức", dataIndex: "severity", width: 110, render: value => <Tag color={value === "BLOCKING" ? "red" : "orange"}>{value === "BLOCKING" ? "Chặn" : "Cảnh báo"}</Tag> },
          { title: "Vi phạm", dataIndex: "violationCount", width: 90, align: "right", render: (value: number) => value ? <Tag color="error">{value}</Tag> : <Tag color="success">0</Tag> }, { title: "Chưa xử lý", dataIndex: "pending", width: 110, align: "right" }]} />
    </div>
    <Modal open={Boolean(ack)} title="Xác nhận cảnh báo CP-08" okText="Xác nhận" okButtonProps={{ disabled: !ack?.reason.trim(), loading: acknowledge.isPending }} onOk={() => acknowledge.mutate()} onCancel={() => setAck(null)}>
      <Input.TextArea rows={3} value={ack?.reason} onChange={event => setAck(current => current && { ...current, reason: event.target.value })} placeholder="Lý do chênh lệch đã được kiểm tra" />
      {acknowledge.isError && <Alert type="error" showIcon message={errorMessage(acknowledge.error)} />}
    </Modal>
  </section>;
}

/** FR-7.5: DRAFT → APPROVED → LOCKED with re-entered password for the one-way lock, history and compliance evidence. */
function ApprovalPanel({ sheet, periodCode, canApprove, canLock }: { sheet: SheetView["sheet"]; periodCode: string; canApprove: boolean; canLock: boolean }) {
  const client = useQueryClient();
  const [dialog, setDialog] = useState<"approve" | "return" | "lock" | null>(null);
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const history = useQuery({ queryKey: ["payroll-history", sheet.id, sheet.revision], queryFn: () => payrollApi.history(sheet.id) });
  const status = history.data?.status ?? sheet.status;
  const revision = history.data?.revision ?? sheet.revision;
  const close = () => { setDialog(null); setNote(""); setPassword(""); };
  const refresh = () => { close(); void client.invalidateQueries({ queryKey: ["payroll-history", sheet.id] }); void client.invalidateQueries({ queryKey: ["payroll-sheet"] }); void client.invalidateQueries({ queryKey: ["payroll-periods"] }); };
  const action = useMutation({
    mutationFn: async () => {
      if (dialog === "approve") return payrollApi.approve(sheet.id, revision, note.trim() || undefined);
      if (dialog === "return") return payrollApi.returnToDraft(sheet.id, revision, note.trim());
      const { token } = await payrollApi.reauthenticate(password);
      return payrollApi.lock(sheet.id, revision, token, note.trim() || undefined);
    },
    onSuccess: refresh,
    onError: () => { setPassword(""); void client.invalidateQueries({ queryKey: ["payroll-history", sheet.id] }); },
  });
  const report = useMutation({ mutationFn: async () => saveBlob(await payrollApi.complianceReport(sheet.id), `bang-chung-tuan-thu-${periodCode}.pdf`) });
  const blockers = history.data?.blockers ?? [];
  const [statusLabel, statusColor] = SHEET_STATUS[status] ?? [status, "default"];
  return <section aria-label="Duyệt và khóa bảng lương" className="tab-stack">
    <Space wrap>
      <Text strong>Trạng thái bảng lương:</Text><Tag color={statusColor} className={status === "LOCKED" ? "status-locked" : undefined} icon={status === "LOCKED" ? <LockOutlined /> : undefined}>{statusLabel}</Tag>
      {status === "DRAFT" && canApprove && <Button type="primary" icon={<CheckCircleOutlined />} disabled={blockers.length > 0} onClick={() => setDialog("approve")}>Duyệt bảng lương</Button>}
      {status === "APPROVED" && canApprove && <Button icon={<RollbackOutlined />} onClick={() => setDialog("return")}>Trả về nháp</Button>}
      {status === "APPROVED" && canLock && <Button type="primary" danger icon={<LockOutlined />} onClick={() => setDialog("lock")}>Khóa kỳ lương</Button>}
      {status === "LOCKED" && <Button icon={<FilePdfOutlined />} loading={report.isPending} onClick={() => report.mutate()}>Tải PDF bằng chứng tuân thủ</Button>}
    </Space>
    {status === "DRAFT" && blockers.length > 0 && <Alert type="warning" showIcon message="Chưa đủ điều kiện duyệt" description={<ul className="plain-list">{blockers.map(item => <li key={item.code}>{item.message}{item.employees && ": " + item.employees.map(employee => `${employee.code} ${employee.fullName}`).join(", ")}</li>)}</ul>} />}
    {status === "APPROVED" && <Alert type="info" showIcon message="Bảng lương đã duyệt" description="Mọi thay đổi nguồn (đầu vào lương, phương án, quyết định lương, mức BH, quy tắc thuế) sẽ tự đưa bảng về Nháp và phải tính, duyệt lại." />}
    {history.data?.snapshot && <Descriptions size="small" bordered column={1} items={[
      { key: "at", label: "Khóa lúc", children: `${new Date(history.data.snapshot.lockedAt).toLocaleString("vi-VN")} — ${history.data.snapshot.lockedBy.displayName}` },
      { key: "hash", label: "Mã băm snapshot", children: <Text code copyable>{history.data.snapshot.contentHash}</Text> },
    ]} />}
    {report.isError && <Alert type="error" showIcon message="Không tải được báo cáo" description={errorMessage(report.error)} />}
    {history.data && history.data.items.length > 0 && <div className="table-panel" role="region" tabIndex={0} aria-label="Lịch sử duyệt bảng lương; dùng phím mũi tên để cuộn"><Table<SheetHistoryItem> size="small" rowKey="id" pagination={false} scroll={{ x: 760 }} dataSource={history.data.items} columns={[
      { title: "Thời điểm", dataIndex: "createdAt", width: 170, render: value => new Date(value).toLocaleString("vi-VN") },
      { title: "Thao tác", dataIndex: "action", width: 190, render: (value: string, row) => <>{ACTION_LABEL[value] ?? value}<br /><Text type="secondary">{(SHEET_STATUS[row.fromStatus]?.[0] ?? row.fromStatus) + " → " + (SHEET_STATUS[row.toStatus]?.[0] ?? row.toStatus)}</Text></> },
      { title: "Người", render: (_, row) => row.actor?.displayName ?? "Hệ thống", width: 150 },
      { title: "Tổng thực lĩnh", align: "right", width: 150, render: (_, row) => row.totals ? money(row.totals.net) : "—" },
      { title: "Lý do / ghi chú", dataIndex: "reason", render: value => value ?? "—" },
    ]} /></div>}
    <Modal open={dialog === "approve"} title={`Duyệt bảng lương ${periodCode}?`} okText="Duyệt" okButtonProps={{ loading: action.isPending }} onOk={() => action.mutate()} onCancel={close}>
      <p>Bảng lương sẽ chuyển sang Đã duyệt với tổng tiền và mã băm nguồn hiện tại. Thay đổi nguồn sau đó sẽ đưa bảng về Nháp.</p>
      <Input.TextArea rows={2} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Ghi chú rà soát (không bắt buộc)" />
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    </Modal>
    <Modal open={dialog === "return"} title="Trả bảng lương về nháp" okText="Trả về nháp" okButtonProps={{ disabled: !note.trim(), loading: action.isPending }} onOk={() => action.mutate()} onCancel={close}>
      <Input.TextArea rows={3} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Lý do trả về nháp" />
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    </Modal>
    <Modal open={dialog === "lock"} title={`Khóa kỳ lương ${periodCode}`} okText="Khóa vĩnh viễn" okButtonProps={{ danger: true, disabled: !password, loading: action.isPending }} onOk={() => action.mutate()} onCancel={close}>
      <Alert type="warning" showIcon message="Thao tác một chiều" description="Sau khi khóa, dòng lương, bảo hiểm và thuế của kỳ không thể sửa hay mở khóa lại. Điều chỉnh phát sinh sẽ xử lý ở kỳ sau." />
      <div className="tab-stack" style={{ marginTop: 12 }}>
        <label>Nhập lại mật khẩu để xác nhận<Input.Password autoComplete="current-password" value={password} maxLength={128} onChange={event => setPassword(event.target.value)} onPressEnter={() => password && action.mutate()} /></label>
        <Input.TextArea rows={2} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Ghi chú khóa kỳ (không bắt buộc)" />
      </div>
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    </Modal>
  </section>;
}

export function PayrollSheetPanel({ canCalculate, canApprove, canLock }: { canCalculate: boolean; canApprove: boolean; canLock: boolean }) {
  const client = useQueryClient();
  const [periodId, setPeriodId] = useState<string>();
  const [selected, setSelected] = useState<SheetEmployee | null>(null);
  const periods = useQuery({ queryKey: ["payroll-periods"], queryFn: payrollApi.periods });
  const runs = useQuery({ queryKey: ["payroll-runs", periodId], queryFn: () => payrollApi.runs(periodId!), enabled: Boolean(periodId), refetchInterval: query => query.state.data?.items[0]?.status === "RUNNING" ? 1000 : false });
  const latest = runs.data?.items[0];
  const latestDetail = useQuery({ queryKey: ["payroll-run", latest?.id, latest?.status], queryFn: () => payrollApi.run(latest!.id), enabled: Boolean(latest && latest.status !== "RUNNING") });
  const sheet = useQuery({ queryKey: ["payroll-sheet", periodId, latest?.id, latest?.status], queryFn: () => payrollApi.sheet(periodId!), enabled: Boolean(periodId) });
  const start = useMutation({ mutationFn: (payrollPeriodId: string) => payrollApi.start(payrollPeriodId), onSuccess: (_, payrollPeriodId) => void client.invalidateQueries({ queryKey: ["payroll-runs", payrollPeriodId] }) });
  const cancel = useMutation({ mutationFn: (input: { runId: string; payrollPeriodId: string }) => payrollApi.cancel(input.runId), onSuccess: (_, input) => void client.invalidateQueries({ queryKey: ["payroll-runs", input.payrollPeriodId] }) });
  const currentStart = start.variables === periodId;
  const currentCancel = cancel.variables?.payrollPeriodId === periodId;
  const data = !sheet.isError && sheet.data && sheet.data.sheet ? sheet.data as SheetView : null;
  const period = periods.data?.items.find(item => item.id === periodId);
  const dueSoon = periods.data?.items.filter(item => item.dueWarning) ?? [];
  const locked = period?.status === "LOCKED" || data?.sheet.status === "LOCKED";
  return <div className="tab-stack">
    {dueSoon.length > 0 && <Alert type="warning" showIcon message="Kỳ lương sắp đến hạn chi nhưng chưa khóa" description={<ul className="plain-list">{dueSoon.map(item => <li key={item.id}><Button type="link" size="small" onClick={() => setPeriodId(item.id)}>{item.code} — {item.siteName}</Button> ngày chi {item.expectedPaymentDate}: {dueText(item)}</li>)}</ul>} />}
    <div className="workspace-filters">
      <label>Kỳ lương<Select style={{ minWidth: 320 }} value={periodId} placeholder="Chọn kỳ lương" loading={periods.isLoading} onChange={setPeriodId} options={periods.data?.items.map(item => ({ value: item.id, label: `${item.code} — ${item.siteName} (${item.dateFrom} → ${item.dateTo})${item.status === "LOCKED" ? " · đã khóa" : item.dueWarning ? " · ⚠ " + dueText(item) : ""}` }))} /></label>
      {canCalculate && periodId && !locked && <Space><Button type="primary" icon={<PlayCircleOutlined />} loading={start.isPending} disabled={latest?.status === "RUNNING"} onClick={() => start.mutate(periodId)}>Chạy tính lương</Button>{latest?.status === "RUNNING" && <Button danger icon={<StopOutlined />} loading={cancel.isPending} onClick={() => cancel.mutate({ runId: latest.id, payrollPeriodId: periodId })}>Dừng an toàn</Button>}</Space>}
    </div>
    {periods.isError && <Alert type="error" showIcon message="Không tải được kỳ lương" description={errorMessage(periods.error)} />}
    {periodId && runs.isError && <Alert type="error" showIcon message="Không tải được trạng thái tính lương" description={errorMessage(runs.error)} />}
    {periodId && sheet.isError && <Alert type="error" showIcon message="Không tải được bảng lương" description={errorMessage(sheet.error)} />}
    {latestDetail.isError && <Alert type="error" showIcon message="Không tải được kết quả lần tính" description={errorMessage(latestDetail.error)} />}
    {currentCancel && cancel.isError && <Alert type="error" showIcon message="Chưa dừng được lần tính" description={errorMessage(cancel.error)} />}
    {currentStart && start.isPending && <div className="task-status" role="status">Đang gửi yêu cầu tính lương…</div>}
    {currentCancel && cancel.isPending && <div className="task-status" role="status">Đang yêu cầu dừng an toàn…</div>}
    {currentStart && start.isError && <Alert type="error" showIcon message="Không chạy được" description={errorMessage(start.error)} />}
    {latest && <Alert key={`${latest.id}-${latest.status}`} className={`task-feedback${latest.status === "COMPLETED" && latest.errorCount === 0 ? " task-feedback-success" : ""}`} type={latest.status === "FAILED" ? "error" : latest.status === "RUNNING" ? "info" : latest.status === "CANCELLED" || latest.errorCount > 0 ? "warning" : "success"} showIcon icon={latest.status === "RUNNING" ? <LoadingOutlined spin aria-hidden="true" /> : undefined} role={latest.status === "FAILED" ? "alert" : "status"} message={<Space wrap>{`Lần tính ${new Date(latest.startedAt).toLocaleString("vi-VN")} — ${RUN_LABEL[latest.status]}`}{latest.progressTotal > 0 ? <Progress percent={Math.round(latest.progressDone * 100 / latest.progressTotal)} status={latest.status === "FAILED" ? "exception" : latest.status === "COMPLETED" && latest.errorCount === 0 ? "success" : "normal"} size="small" style={{ width: 160 }} /> : latest.status === "RUNNING" ? <Text type="secondary">Đang xác định phạm vi xử lý…</Text> : null}{latest.errorCount > 0 && <Tag color="error">{latest.errorCount} lỗi</Tag>}</Space>} description={latest.failure ?? (latest.sourceHash ? <Text type="secondary">Hash nguồn {latest.sourceHash.slice(0, 16)}…</Text> : undefined)} />}
    {latestDetail.data?.errors.length ? <Alert type="warning" showIcon message="Nhân viên lỗi (đã cô lập)" description={<ul className="plain-list">{latestDetail.data.errors.map(error => <li key={(error.employee?.code ?? "") + error.code}>{error.employee?.code} {error.employee?.fullName}: {error.code} — {error.message}</li>)}</ul>} /> : null}
    {periods.isLoading ? (
      <div className="task-status" role="status"><Spin size="small" />Đang tải danh sách kỳ lương…</div>
    ) : periods.isError ? null : !periodId ? (
      <Empty className="business-empty" image={<BusinessIllustration kind="payroll" />} description={periods.data?.items.length ? "Chọn kỳ lương để xem bảng lương." : "Chưa có kỳ lương trong phạm vi của bạn."} />
    ) : sheet.isLoading || runs.isLoading || (!data && (sheet.isFetching || runs.isFetching)) ? (
      <div className="task-status" role="status"><Spin size="small" />Đang tải bảng lương và trạng thái tính…</div>
    ) : sheet.isError || runs.isError ? null : !data ? (
      (currentStart && start.isPending) || latest?.status === "RUNNING" ? (
        <div className="task-status" role="status">Bảng lương sẽ hiển thị khi máy chủ có kết quả.</div>
      ) : (currentStart && start.isError) || latest?.status === "FAILED" || latest?.status === "CANCELLED" || (latest?.errorCount ?? 0) > 0 ? null : (
        <Empty className="business-empty" image={<BusinessIllustration kind="payroll" />} description="Chưa có bảng lương nháp cho kỳ này." />
      )
    ) : <>
      <div className="context-strip" aria-label="Tổng quan bảng lương"><Statistic title="Nhân viên" value={data.totals.employees} /><Statistic title="Tổng thu nhập" value={money(data.totals.gross)} /><Statistic title="BH NLĐ" value={money(data.totals.insuranceEmployee)} /><Statistic title="Thuế TNCN" value={money(data.totals.tax)} /><Statistic title={<span className="metric-label"><span>Thực lĩnh</span><BusinessIllustration kind="payroll" /></span>} value={money(data.totals.net)} /><Statistic title="Số lần tính" value={data.sheet.calcCount} /></div>
      <ApprovalPanel sheet={data.sheet} periodCode={data.sheet.payrollPeriod.code} canApprove={canApprove} canLock={canLock} />
      <Title level={4}>Cổng tuân thủ CP-01…CP-09</Title>
      <CompliancePanel sheetId={data.sheet.id} canCalculate={canCalculate && data.sheet.status === "DRAFT"} employees={data.items} />
      <Title level={4}>{data.sheet.status === "LOCKED" ? "Bảng lương đã khóa" : data.sheet.status === "APPROVED" ? "Bảng lương đã duyệt" : "Bảng lương nháp"}</Title>
      <div className="table-panel" role="region" tabIndex={0} aria-label="Bảng lương theo nhân viên; dùng phím mũi tên để cuộn">
        <Table<SheetEmployee> rowKey="id" dataSource={data.items} scroll={{ x: 980 }} pagination={{ pageSize: 20, showSizeChanger: false }} onRow={row => ({ onClick: () => setSelected(row) })} columns={[
          { title: "Nhân sự", render: (_, row) => <>{row.employee.code}<br /><Text type="secondary">{row.employee.fullName}</Text></>, width: 200 },
          { title: "Trạng thái", dataIndex: "status", width: 110, render: (value, row) => value === "OK" ? (row.violations.some(v => v.severity === "BLOCKING") ? <Tag color="red">Vi phạm</Tag> : <Tag color="success">OK</Tag>) : <Tag color="error">{row.errors[0]?.code ?? "Lỗi"}</Tag> },
          { title: "Tổng thu nhập", render: (_, row) => money(row.totals.gross), align: "right" }, { title: "BH NLĐ", render: (_, row) => money(Number(row.totals.insuranceEmployee) + Number(row.totals.unionFee)), align: "right" },
          { title: "Thuế", render: (_, row) => money(row.totals.tax), align: "right" }, { title: "Thực lĩnh", render: (_, row) => <strong>{money(row.totals.net)}</strong>, align: "right" },
          { title: "Cổng", render: (_, row) => row.violations.map(v => <Tag key={v.code + v.message} color={v.severity === "BLOCKING" ? "red" : "orange"}>{v.code}</Tag>) },
        ]} />
      </div>
      {selected && <EmployeeLines sheetId={data.sheet.id} employee={selected} onClose={() => setSelected(null)} />}
    </>}
  </div>;
}
