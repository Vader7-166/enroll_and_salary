import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { employeeApi } from "../api/hrtp";
import type { AuthUser } from "../api/hrtp";
import { payrollApi } from "../api/payroll";
import { terminationApi } from "../api/terminations";
import type { AlertKind, ContractAlert, TerminationDecision, TerminationReason } from "../api/terminations";

const { Title, Paragraph, Text } = Typography;
const vnd = (value: string | null | undefined) => value == null ? "—" : Number(value).toLocaleString("vi-VN") + " đ";
const ALERT: Record<AlertKind, [string, string]> = { OVERDUE: ["Đã quá hạn", "red"], PROBATION_ENDING: ["Hết thử việc", "orange"], EXPIRING: ["Sắp hết hạn", "gold"], FIXED_TERM_LIMIT: ["Đủ 2 HĐ xác định thời hạn", "purple"] };
const REASONS: Record<TerminationReason, string> = { RESIGNATION: "Thôi việc (người lao động nghỉ)", CONTRACT_EXPIRY: "Hết hạn hợp đồng", MUTUAL_AGREEMENT: "Hai bên thỏa thuận", JOB_LOSS: "Mất việc làm (thay đổi cơ cấu, kinh tế)", OTHER: "Lý do khác (không trợ cấp)" };
const STATUS: Record<TerminationDecision["status"], [string, string]> = { DRAFT: ["Nháp — chưa đổi dữ liệu", "gold"], CONFIRMED: ["Đã xác nhận", "success"], CANCELLED: ["Đã hủy", "default"] };

function AlertsTab() {
  const [days, setDays] = useState<30 | 60>(30);
  const alerts = useQuery({ queryKey: ["contract-alerts", days], queryFn: () => terminationApi.alerts(days) });
  return <div className="tab-stack">
    <Space wrap><Text>Ngưỡng cảnh báo</Text><Radio.Group value={days} onChange={event => setDays(event.target.value)} options={[{ value: 30, label: "30 ngày" }, { value: 60, label: "60 ngày" }]} optionType="button" /></Space>
    <Alert type="info" showIcon message="Cảnh báo chỉ để theo dõi: hệ thống không tự chấm dứt hay đổi trạng thái hợp đồng khi hết hạn." />
    {alerts.isError ? <Alert type="error" showIcon message="Không tải được cảnh báo" description={errorMessage(alerts.error)} /> :
      <Table<ContractAlert> rowKey={row => row.kind + row.contract.id} size="small" loading={alerts.isLoading} dataSource={alerts.data?.items ?? []} pagination={false} scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description="Không có hợp đồng cần chú ý" /> }}
        columns={[
          { title: "Loại", width: 200, render: (_, row) => <Tag color={ALERT[row.kind][1]}>{ALERT[row.kind][0]}</Tag> },
          { title: "Nhân sự", width: 220, render: (_, row) => <>{row.employee.fullName}<small className="table-subtext">{row.employee.code} · {row.employee.unitCode ?? "—"}</small></> },
          { title: "Hợp đồng", width: 200, render: (_, row) => <>{row.contract.number}<small className="table-subtext">{row.contract.startDate} → {row.contract.endDate ?? "không thời hạn"}</small></> },
          { title: "Còn lại", width: 100, align: "right", render: (_, row) => row.daysLeft === null ? "—" : row.daysLeft < 0 ? <Text type="danger">{row.daysLeft} ngày</Text> : row.daysLeft + " ngày" },
          { title: "Nội dung", dataIndex: "message" },
        ]} />}
  </div>;
}

function PreviewView({ decision }: { decision: TerminationDecision }) {
  const preview = decision.preview;
  return <div className="tab-stack">
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: "e", label: "Nhân sự", children: preview.employee.fullName + " (" + preview.employee.code + ")" },
      { key: "d", label: "Ngày chấm dứt", children: preview.effectiveDate },
      { key: "c", label: "Hợp đồng hiệu lực", children: preview.contract.number + " · từ " + preview.contract.startDate },
      { key: "r", label: "Lý do", children: REASONS[preview.reason] },
      { key: "w", label: "Thời gian làm việc", children: preview.service.workedMonths + " tháng" },
      { key: "u", label: "Đã tham gia BHTN", children: (preview.service.unemploymentMonthsSystem + preview.service.unemploymentMonthsExternal) + " tháng" + (preview.service.unemploymentMonthsExternal ? " (gồm " + preview.service.unemploymentMonthsExternal + " tháng ngoài hệ thống: " + preview.service.externalEvidence + ")" : "") },
      { key: "p", label: "Đã chi trợ cấp trước đây", children: preview.service.previouslyPaidMonths + " tháng" },
      { key: "s", label: "Lương bình quân " + preview.salary.months.length + " tháng", children: vnd(preview.salary.average) },
      { key: "a", label: preview.allowance?.kind === "JOB_LOSS" ? "Trợ cấp mất việc làm" : "Trợ cấp thôi việc", span: 2, children: preview.allowance
        ? <>{vnd(preview.allowance.amount)} <Text type="secondary">= {preview.allowance.years} năm ({preview.allowance.countedMonths} tháng tính) × {preview.allowance.monthsPerYear} tháng lương × {vnd(preview.allowance.averageSalary)}{preview.allowance.minimumApplied ? " — áp dụng mức tối thiểu " + vnd(preview.allowance.minimum) : ""}</Text></>
        : <Text type="secondary">Không thuộc diện trợ cấp</Text> },
      { key: "l", label: "Tiền phép năm chưa nghỉ", span: 2, children: <>{vnd(preview.unusedLeave.amount)} <Text type="secondary">= {preview.unusedLeave.days} ngày × {vnd(preview.unusedLeave.dailyRate)} (lương ÷ {preview.unusedLeave.standardWorkdays} công)</Text></> },
      { key: "i", label: "Báo giảm BH", span: 2, children: preview.insuranceDecrease ? "Báo giảm từ " + preview.insuranceDecrease.effectiveDate + " (mức đóng " + vnd(preview.insuranceDecrease.base) + ")" : "Không phát sinh" },
      { key: "k", label: "Kỳ lương nhận khoản", span: 2, children: preview.payrollPeriod ? preview.payrollPeriod.code + " (" + preview.payrollPeriod.dateFrom + " → " + preview.payrollPeriod.dateTo + ")" : "Chưa có kỳ lương mở — khoản chờ và gắn khi tính kỳ kế tiếp" },
    ]} />
  </div>;
}

function TerminationDrawer({ decision, onClose }: { decision: TerminationDecision | null; onClose: () => void }) {
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [current, setCurrent] = useState<TerminationDecision | null>(null);
  const shown = current?.id === decision?.id ? current : decision;
  const done = (next: TerminationDecision) => { setCurrent(next); void client.invalidateQueries({ queryKey: ["terminations"] }); };
  const refresh = useMutation({ mutationFn: () => terminationApi.refresh(shown!), onSuccess: data => done(data.decision) });
  const confirm = useMutation({ mutationFn: async () => terminationApi.confirm(shown!, (await payrollApi.reauthenticate(password)).token), onSuccess: data => { setConfirming(false); setPassword(""); done(data.decision); } });
  const cancel = useMutation({ mutationFn: () => terminationApi.cancel(shown!, cancelReason ?? ""), onSuccess: data => { setCancelReason(null); done(data.decision); } });
  const error = refresh.error ?? confirm.error ?? cancel.error;
  return <Drawer width={760} open={Boolean(decision)} onClose={onClose} title={shown ? "Quyết định " + shown.decisionNumber : ""} destroyOnHidden>
    {shown && <div className="tab-stack">
      <Space wrap><Tag color={STATUS[shown.status][1]}>{STATUS[shown.status][0]}</Tag><Text type="secondary">Lập bởi {shown.createdBy}{shown.confirmedBy ? " · xác nhận bởi " + shown.confirmedBy : ""}</Text></Space>
      {shown.status === "DRAFT" && <Alert type="warning" showIcon message="Đây là bản xem trước. Hợp đồng, nhân sự, bảng lương và BH chưa thay đổi cho đến khi KT xác nhận." />}
      {error && <Alert type="error" showIcon message="Không thực hiện được" description={errorMessage(error)} />}
      <PreviewView decision={shown} />
      {shown.status === "DRAFT" && <Space wrap>
        <Button type="primary" onClick={() => setConfirming(true)}>Xác nhận chấm dứt</Button>
        <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>Làm mới xem trước</Button>
        <Button danger onClick={() => setCancelReason("")}>Hủy quyết định</Button>
      </Space>}
    </div>}
    <Modal title="Xác nhận chấm dứt hợp đồng" open={confirming} onCancel={() => setConfirming(false)} okText="Xác nhận" okButtonProps={{ disabled: !password, loading: confirm.isPending }} onOk={() => confirm.mutate()}>
      <Paragraph>Xác nhận sẽ ghi ngày nghỉ việc, đánh dấu hợp đồng đã chấm dứt và đưa trợ cấp, tiền phép vào kỳ lương <b>một lần duy nhất</b>. Nhập lại mật khẩu để tiếp tục.</Paragraph>
      <Input.Password autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
    </Modal>
    <Modal title="Hủy quyết định nháp" open={cancelReason !== null} onCancel={() => setCancelReason(null)} okText="Hủy quyết định" okButtonProps={{ danger: true, disabled: !cancelReason?.trim(), loading: cancel.isPending }} onOk={() => cancel.mutate()}>
      <Input.TextArea rows={3} value={cancelReason ?? ""} onChange={event => setCancelReason(event.target.value)} placeholder="Lý do hủy" />
    </Modal>
  </Drawer>;
}

function CreateTermination({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (decision: TerminationDecision) => void }) {
  const [form] = Form.useForm();
  const [search, setSearch] = useState("");
  const employees = useQuery({ queryKey: ["employees", "termination", search], queryFn: () => employeeApi.list({ page: 1, pageSize: 20, search, status: "ACTIVE" }), enabled: open });
  const create = useMutation({ mutationFn: terminationApi.create, onSuccess: data => { form.resetFields(); onCreated(data.decision); } });
  return <Modal title="Lập quyết định chấm dứt (nháp)" open={open} onCancel={onClose} footer={null} destroyOnHidden width={640}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={create.isPending} initialValues={{ reason: "RESIGNATION", externalUnemploymentMonths: 0 }}
      onFinish={values => create.mutate({ ...values, externalUnemploymentEvidence: values.externalUnemploymentEvidence?.trim() || undefined, note: values.note?.trim() || undefined })}>
      <Form.Item name="employeeId" label="Nhân sự" rules={[{ required: true, message: "Chọn nhân sự." }]}>
        <Select showSearch filterOption={false} onSearch={setSearch} loading={employees.isLoading} options={employees.data?.items.map(item => ({ value: item.id, label: item.code + " — " + item.fullName }))} />
      </Form.Item>
      <div className="form-grid">
        <Form.Item name="decisionNumber" label="Số quyết định" rules={[{ required: true, whitespace: true, message: "Nhập số quyết định." }]}><Input /></Form.Item>
        <Form.Item name="effectiveDate" label="Ngày chấm dứt (ngày làm việc cuối)" rules={[{ required: true, message: "Chọn ngày." }]}><Input type="date" /></Form.Item>
      </div>
      <Form.Item name="reason" label="Lý do" rules={[{ required: true }]}><Select options={Object.entries(REASONS).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item name="legalBasis" label="Căn cứ" rules={[{ required: true, whitespace: true, message: "Nhập căn cứ." }]}><Input placeholder="Ví dụ: BLLĐ 2019 Điều 35, 46; đơn xin nghỉ ngày …" /></Form.Item>
      <div className="form-grid">
        <Form.Item name="externalUnemploymentMonths" label="Số tháng BHTN ngoài hệ thống"><InputNumber min={0} max={600} precision={0} className="full-width" /></Form.Item>
        <Form.Item name="externalUnemploymentEvidence" label="Chứng từ BHTN ngoài hệ thống" dependencies={["externalUnemploymentMonths"]} rules={[({ getFieldValue }) => ({ validator: (_, value) => !getFieldValue("externalUnemploymentMonths") || value?.trim() ? Promise.resolve() : Promise.reject(new Error("Cần chứng từ khi nhập số tháng.")) })]}><Input /></Form.Item>
      </div>
      <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} /></Form.Item>
      {create.isError && <Alert type="error" showIcon message="Không lập được quyết định" description={errorMessage(create.error)} />}
      <Space className="modal-actions"><Button onClick={onClose}>Đóng</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Lập nháp và xem trước</Button></Space>
    </Form>
  </Modal>;
}

function TerminationsTab({ canManage }: { canManage: boolean }) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<TerminationDecision | null>(null);
  const list = useQuery({ queryKey: ["terminations"], queryFn: terminationApi.list });
  return <div className="tab-stack">
    {canManage && <div><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Lập quyết định chấm dứt</Button></div>}
    {list.isError ? <Alert type="error" showIcon message="Không tải được quyết định" description={errorMessage(list.error)} /> :
      <Table<TerminationDecision> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data?.items ?? []} pagination={false} scroll={{ x: 900 }}
        onRow={row => ({ onClick: () => setSelected(row), className: "clickable-row" })} locale={{ emptyText: <Empty description="Chưa có quyết định chấm dứt" /> }}
        columns={[
          { title: "Số quyết định", dataIndex: "decisionNumber", width: 180 },
          { title: "Nhân sự", width: 220, render: (_, row) => row.employee ? <>{row.employee.fullName}<small className="table-subtext">{row.employee.code}</small></> : "—" },
          { title: "Ngày chấm dứt", dataIndex: "effectiveDate", width: 130 },
          { title: "Lý do", width: 220, render: (_, row) => REASONS[row.reason] },
          { title: "Trợ cấp + phép", width: 160, align: "right", render: (_, row) => vnd(String(Number(row.preview.allowance?.amount ?? 0) + Number(row.preview.unusedLeave.amount))) },
          { title: "Trạng thái", width: 200, render: (_, row) => <Tag color={STATUS[row.status][1]}>{STATUS[row.status][0]}</Tag> },
        ]} />}
    <CreateTermination open={creating} onClose={() => setCreating(false)} onCreated={decision => { setCreating(false); setSelected(decision); void list.refetch(); }} />
    <TerminationDrawer decision={selected} onClose={() => setSelected(null)} />
  </div>;
}

export function ContractsWorkspace({ user }: { user: AuthUser }) {
  return <div className="content-stack">
    <div className="page-heading"><div><p className="eyebrow">HỒ SƠ / HỢP ĐỒNG</p><Title level={1}>Hợp đồng & chấm dứt</Title>
      <Paragraph type="secondary">Theo dõi hợp đồng sắp hết hạn và lập quyết định chấm dứt có xem trước trợ cấp, tiền phép chưa nghỉ và báo giảm BH.</Paragraph></div></div>
    <section className="panel settings-panel"><Tabs items={[{ key: "alerts", label: "Cảnh báo hợp đồng", children: <AlertsTab /> }, { key: "terminations", label: "Chấm dứt hợp đồng", children: <TerminationsTab canManage={user.permissions.includes("contract.manage")} /> }]} /></section>
  </div>;
}
