import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Form, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { employeeApi, organizationApi } from "../api/hrtp";
import { payrollApi } from "../api/payroll";
import { payrollAdjustmentsApi } from "../api/payroll-adjustments";
import type { BonusAllocation, BonusPlan, BonusType, PayrollAdjustmentRow, RetroCalculation, RetroCandidateRow, RetroPeriod } from "../api/payroll-adjustments";

const { Text, Paragraph, Title } = Typography;
const money = (value: string | number) => Math.round(Number(value)).toLocaleString("vi-VN") + " đ";
const signed = (value: string | number) => (Number(value) > 0 ? "+" : "") + money(value);
const BONUS_TYPE: Record<BonusType, string> = { MONTHLY: "Tháng", QUARTERLY: "Quý", ANNUAL: "Năm", KPI: "KPI", HOLIDAY: "Lễ Tết", SENIORITY: "Thâm niên", AD_HOC: "Đột xuất" };
const PLAN_STATUS: Record<BonusPlan["status"], [string, string]> = { DRAFT: ["Nháp", "default"], CONFIRMED: ["Đã xác nhận", "success"], CANCELLED: ["Đã hủy", "default"] };
const ADJUSTMENT_KIND: Record<string, string> = { RETRO_PAY: "Truy lĩnh", RETRO_DEDUCT: "Truy thu", LATE_PAYMENT_COMPENSATION: "Đền bù chậm trả" };

function EmployeePicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [search, setSearch] = useState("");
  const list = useQuery({ queryKey: ["bonus-employee-search", search], queryFn: () => employeeApi.list({ page: 1, pageSize: 20, search, status: "ACTIVE" }) });
  return <Select mode="multiple" showSearch filterOption={false} value={value} onChange={onChange} onSearch={setSearch} loading={list.isFetching} placeholder="Tìm mã hoặc tên nhân viên" style={{ minWidth: 320 }}
    options={(list.data?.items ?? []).map(employee => ({ value: employee.id, label: `${employee.code} — ${employee.fullName}` }))} />;
}

function BonusDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["bonus", id], queryFn: () => payrollAdjustmentsApi.bonus(id) });
  const organization = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  const [target, setTarget] = useState<"employees" | "unit">("employees");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const plan = detail.data?.plan;
  const refresh = () => { void client.invalidateQueries({ queryKey: ["bonus", id] }); void client.invalidateQueries({ queryKey: ["bonuses"] }); };
  const allocate = useMutation({ mutationFn: () => payrollAdjustmentsApi.allocate(id, target === "unit" ? { orgUnitId, inputs } : { items: employeeIds.map(employeeId => ({ employeeId, inputs })) }), onSuccess: () => { setEmployeeIds([]); refresh(); } });
  const remove = useMutation({ mutationFn: (allocationId: string) => payrollAdjustmentsApi.removeAllocation(id, allocationId), onSuccess: refresh });
  const confirm = useMutation({ mutationFn: () => payrollAdjustmentsApi.confirmBonus(id, plan!.revision), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => payrollAdjustmentsApi.cancelBonus(id, plan!.revision, cancelReason!), onSuccess: () => { setCancelReason(null); refresh(); } });
  const variables = plan?.variables ?? [];
  const conflicts = (detail.data?.allocations ?? []).filter(row => row.conflictCode);
  return <Drawer open width={880} title={plan ? `${plan.code} — ${plan.name}` : "Đợt thưởng"} onClose={onClose}>
    {detail.isError && <Alert type="error" showIcon message={errorMessage(detail.error)} />}
    {plan && <div className="tab-stack">
      <Descriptions size="small" bordered column={2} items={[
        { key: "status", label: "Trạng thái", children: <Tag color={PLAN_STATUS[plan.status][1]}>{PLAN_STATUS[plan.status][0]}</Tag> }, { key: "type", label: "Loại", children: BONUS_TYPE[plan.bonusType] },
        { key: "earn", label: "Kỳ hưởng", children: `${plan.earnFrom} → ${plan.earnTo}` }, { key: "pay", label: "Kỳ lương chi", children: plan.payPeriod.code },
        { key: "decision", label: "Căn cứ", children: plan.decisionReference }, { key: "independent", label: "Quyết định độc lập", children: plan.independentDecisionRef ?? "—" },
        { key: "rule", label: "Cách tính", span: 2, children: plan.calculationMode === "AMOUNT" ? `Cố định ${money(plan.amount!)}` : <Text code>{plan.formula}</Text> },
      ]} />
      {conflicts.length > 0 && <Alert type="error" showIcon message="Trùng nguồn KPI với P3 (BONUS_P3_DOUBLE_COUNT)" description={<ul className="plain-list">{conflicts.map(row => <li key={row.id}>{row.employee.code} {row.employee.fullName}: {row.conflictDetail}</li>)}</ul>} />}
      {plan.status === "DRAFT" && <div className="tab-stack">
        <Title level={5}>Thêm người nhận</Title>
        <Radio.Group value={target} onChange={event => setTarget(event.target.value)} options={[{ value: "employees", label: "Theo nhân viên" }, { value: "unit", label: "Theo đơn vị" }]} optionType="button" />
        <Space wrap align="end">
          {target === "employees" ? <EmployeePicker value={employeeIds} onChange={setEmployeeIds} /> : <Select showSearch optionFilterProp="label" style={{ minWidth: 320 }} value={orgUnitId} onChange={setOrgUnitId} placeholder="Chọn đơn vị" options={(organization.data?.units ?? []).map(unit => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} />}
          {plan.calculationMode === "FORMULA" && variables.map(variable => <label key={variable.name}>{variable.name}<Input style={{ width: 140 }} value={inputs[variable.name] ?? ""} placeholder={variable.defaultValue ?? "bắt buộc"} onChange={event => setInputs(current => ({ ...current, [variable.name]: event.target.value }))} /></label>)}
          <Button type="primary" icon={<PlusOutlined />} loading={allocate.isPending} disabled={target === "unit" ? !orgUnitId : !employeeIds.length} onClick={() => allocate.mutate()}>Thêm</Button>
        </Space>
        <Paragraph type="secondary">Mỗi người chỉ nhận một lần trong đợt. Điểm chuyên cần, KPI chỉ là biến của công thức thưởng, không trừ lương.</Paragraph>
        {allocate.isError && <Alert type="error" showIcon message={errorMessage(allocate.error)} />}
      </div>}
      <Table<BonusAllocation> size="small" rowKey="id" pagination={{ pageSize: 20, showSizeChanger: false }} dataSource={detail.data!.allocations} columns={[
        { title: "Nhân sự", render: (_, row) => <>{row.employee.code}<br /><Text type="secondary">{row.employee.fullName}</Text></> },
        { title: "Biến", render: (_, row) => Object.entries(row.inputs).filter(([name]) => name !== "RAW").map(([name, value]) => `${name}=${value}`).join(", ") || "—" },
        { title: "Thưởng", dataIndex: "amount", align: "right", render: money },
        { title: "", width: 150, render: (_, row) => <>{row.conflictCode && <Tag color="error">Trùng P3</Tag>}{plan.status === "DRAFT" && <Button size="small" type="link" danger onClick={() => remove.mutate(row.id)}>Bỏ</Button>}</> },
      ]} />
      <Space>
        {plan.status === "DRAFT" && <Button type="primary" loading={confirm.isPending} disabled={!detail.data!.allocations.length || conflicts.length > 0} onClick={() => confirm.mutate()}>Xác nhận đợt thưởng</Button>}
        {plan.status !== "CANCELLED" && <Button danger onClick={() => setCancelReason("")}>Hủy đợt</Button>}
      </Space>
      {confirm.isError && <Alert type="error" showIcon message={errorMessage(confirm.error)} />}
    </div>}
    <Modal open={cancelReason !== null} title="Hủy đợt thưởng" okText="Hủy đợt" okButtonProps={{ danger: true, disabled: !cancelReason?.trim(), loading: cancel.isPending }} onOk={() => cancel.mutate()} onCancel={() => setCancelReason(null)}>
      <Input.TextArea rows={3} value={cancelReason ?? ""} onChange={event => setCancelReason(event.target.value)} placeholder="Lý do hủy" />
      {cancel.isError && <Alert type="error" showIcon message={errorMessage(cancel.error)} />}
    </Modal>
  </Drawer>;
}

export function BonusPlansPanel() {
  const client = useQueryClient();
  const plans = useQuery({ queryKey: ["bonuses"], queryFn: payrollAdjustmentsApi.bonuses });
  const periods = useQuery({ queryKey: ["payroll-periods"], queryFn: payrollApi.periods });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const mode = Form.useWatch("calculationMode", form);
  const create = useMutation({ mutationFn: (values: Record<string, unknown>) => payrollAdjustmentsApi.createBonus(values), onSuccess: ({ plan }) => { setCreating(false); form.resetFields(); setOpen(plan.id); void client.invalidateQueries({ queryKey: ["bonuses"] }); } });
  const submit = (values: { variablesText?: string } & Record<string, unknown>) => {
    const variables = String(values.variablesText ?? "").split(",").map(item => item.trim()).filter(Boolean).map(item => { const [name, defaultValue] = item.split("=").map(part => part.trim()); return { name, ...(defaultValue ? { defaultValue } : {}) }; });
    const { variablesText: _ignored, ...rest } = values;
    create.mutate({ ...rest, ...(values.calculationMode === "FORMULA" ? { variables } : {}) });
  };
  return <div className="tab-stack">
    <div className="workspace-filters"><Button type="primary" icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ bonusType: "KPI", calculationMode: "FORMULA", formula: "TARGET * KPI_RATE", variablesText: "TARGET=5000000, KPI_RATE" }); setCreating(true); }}>Tạo đợt thưởng</Button></div>
    <Paragraph type="secondary">Thưởng chỉ vào bảng lương của kỳ chi đã chọn, tính trước tổng thu nhập và chịu thuế theo ngày chi của kỳ đó.</Paragraph>
    {plans.isError && <Alert type="error" showIcon message={errorMessage(plans.error)} />}
    <Table<BonusPlan> className="workspace-table" rowKey="id" loading={plans.isLoading} dataSource={plans.data?.items ?? []} scroll={{ x: 900 }} onRow={row => ({ onClick: () => setOpen(row.id) })} columns={[
      { title: "Mã", dataIndex: "code", width: 160 }, { title: "Tên", dataIndex: "name" }, { title: "Loại", dataIndex: "bonusType", width: 100, render: (value: BonusType) => BONUS_TYPE[value] },
      { title: "Kỳ chi", render: (_, row) => row.payPeriod.code, width: 160 }, { title: "Người nhận", dataIndex: "employees", align: "right", width: 100 },
      { title: "Tổng", dataIndex: "total", align: "right", render: value => value ? money(value) : "—" },
      { title: "Trạng thái", width: 150, render: (_, row) => <><Tag color={PLAN_STATUS[row.status][1]}>{PLAN_STATUS[row.status][0]}</Tag>{row.conflicts ? <Tag color="error">{row.conflicts} trùng P3</Tag> : null}</> },
    ]} />
    {open && <BonusDrawer id={open} onClose={() => setOpen(null)} />}
    <Modal open={creating} width={720} title="Tạo đợt thưởng" okText="Tạo" confirmLoading={create.isPending} onOk={() => form.submit()} onCancel={() => setCreating(false)} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Space wrap align="start">
          <Form.Item name="code" label="Mã đợt" rules={[{ required: true, message: "Nhập mã." }]}><Input style={{ width: 180 }} maxLength={64} /></Form.Item>
          <Form.Item name="bonusType" label="Loại"><Select style={{ width: 150 }} options={Object.entries(BONUS_TYPE).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="payPayrollPeriodId" label="Kỳ lương chi" rules={[{ required: true, message: "Chọn kỳ chi." }]}><Select style={{ width: 260 }} options={(periods.data?.items ?? []).filter(item => item.status === "OPEN" && item.sheet?.status !== "LOCKED").map(item => ({ value: item.id, label: `${item.code} — ${item.siteName}` }))} /></Form.Item>
        </Space>
        <Form.Item name="name" label="Tên đợt thưởng" rules={[{ required: true, whitespace: true, message: "Nhập tên." }]}><Input maxLength={200} /></Form.Item>
        <Space wrap align="start">
          <Form.Item name="earnFrom" label="Kỳ hưởng từ" rules={[{ required: true, message: "Chọn ngày." }]}><Input type="date" /></Form.Item>
          <Form.Item name="earnTo" label="đến" rules={[{ required: true, message: "Chọn ngày." }]}><Input type="date" /></Form.Item>
        </Space>
        <Form.Item name="decisionReference" label="Căn cứ / quyết định" rules={[{ required: true, whitespace: true, message: "Nhập căn cứ." }]}><Input maxLength={500} /></Form.Item>
        <Space wrap align="start">
          <Form.Item name="kpiSourceReference" label="Nguồn KPI tham chiếu" tooltip="Mã kết quả đánh giá; trùng với P3 của phương án lương mà không có quyết định độc lập sẽ bị chặn."><Input style={{ width: 240 }} maxLength={200} /></Form.Item>
          <Form.Item name="independentDecisionRef" label="Quyết định thưởng độc lập"><Input style={{ width: 280 }} maxLength={500} /></Form.Item>
        </Space>
        <Form.Item name="calculationMode" label="Cách tính"><Radio.Group options={[{ value: "FORMULA", label: "Công thức" }, { value: "AMOUNT", label: "Số tiền cố định" }]} optionType="button" /></Form.Item>
        {mode === "AMOUNT" ? <Form.Item name="amount" label="Số tiền mỗi người" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Nhập số tiền." }]}><Input style={{ width: 200 }} /></Form.Item> : <>
          <Form.Item name="formula" label="Công thức" rules={[{ required: true, message: "Nhập công thức." }]} extra="Ví dụ: TARGET * KPI_RATE hoặc TARGET * ATTENDANCE_SCORE / 100"><Input maxLength={2000} /></Form.Item>
          <Form.Item name="variablesText" label="Biến (TÊN hoặc TÊN=giá trị mặc định, cách nhau dấu phẩy)" rules={[{ required: true, message: "Khai báo biến." }]}><Input /></Form.Item>
        </>}
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: "Nhập lý do." }]}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
        {create.isError && <Alert type="error" showIcon message={errorMessage(create.error)} />}
      </Form>
    </Modal>
  </div>;
}

function RetroTable({ calculation }: { calculation: RetroCalculation }) {
  return <div className="tab-stack">
    {calculation.periods.map((period: RetroPeriod) => <div key={period.periodId} className="tab-stack">
      <Title level={5}>Kỳ gốc {period.code} ({period.dateFrom} → {period.dateTo})</Title>
      <Descriptions size="small" bordered column={3} items={[
        { key: "gross", label: "Thu nhập", children: signed(period.diff.gross) }, { key: "ins", label: "BH NLĐ", children: signed(period.diff.insuranceEmployee) }, { key: "union", label: "Đoàn phí", children: signed(period.diff.unionFee) },
        { key: "tax", label: "Thuế kỳ gốc (tham khảo)", children: <>{signed(period.diff.tax)}<br /><Text type="secondary">Kỳ thuế {period.taxPeriod ?? "?"}</Text></> }, { key: "employer", label: "BH DN", children: signed(period.diff.insuranceEmployer) },
        { key: "adjustment", label: period.adjustment.kind === "RETRO_PAY" ? "Truy lĩnh" : "Truy thu", children: <strong>{signed(period.adjustment.amount)}</strong> },
      ]} />
      <Table size="small" rowKey="key" pagination={false} dataSource={period.lines} columns={[{ title: "Dòng", dataIndex: "label" }, { title: "Snapshot gốc", dataIndex: "before", align: "right", render: money }, { title: "Tính lại", dataIndex: "after", align: "right", render: money }, { title: "Chênh lệch", dataIndex: "diff", align: "right", render: signed }]} />
    </div>)}
    <Alert type="info" showIcon message={`Ghi vào kỳ ${calculation.target.code}: ${signed(calculation.total.adjustment)} trước thuế`} description="Thuế của khoản truy lĩnh tính theo ngày chi của kỳ nhận bút toán; chênh lệch thuế kỳ gốc chỉ để tham khảo, không sửa tờ khai đã nộp. Kỳ gốc giữ nguyên." />
  </div>;
}

export function RetroAdjustmentsPanel() {
  const client = useQueryClient();
  const [status, setStatus] = useState<string | undefined>("PENDING");
  const [calculationId, setCalculationId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const candidates = useQuery({ queryKey: ["payroll-retro-candidates", status], queryFn: () => payrollAdjustmentsApi.candidates(status) });
  const adjustments = useQuery({ queryKey: ["payroll-adjustments"], queryFn: () => payrollAdjustmentsApi.adjustments() });
  const calculation = useQuery({ queryKey: ["retro-calculation", calculationId], queryFn: () => payrollAdjustmentsApi.calculation(calculationId!), enabled: Boolean(calculationId) });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["payroll-retro-candidates"] }); void client.invalidateQueries({ queryKey: ["payroll-adjustments"] }); void client.invalidateQueries({ queryKey: ["retro-calculation"] }); };
  const calculate = useMutation({ mutationFn: (candidateId: string) => payrollAdjustmentsApi.calculate(candidateId), onSuccess: ({ calculation: result }) => { setCalculationId(result.id); refresh(); } });
  const discard = useMutation({ mutationFn: () => payrollAdjustmentsApi.discardRetro(calculationId!), onSuccess: () => { setCalculationId(null); refresh(); } });
  const confirm = useMutation({ mutationFn: async () => { const { token } = await payrollApi.reauthenticate(password); return payrollAdjustmentsApi.confirmRetro(calculationId!, token, calculation.data!.calculation.resultHash); }, onSuccess: () => { setPassword(""); refresh(); }, onError: () => setPassword("") });
  const view = calculation.data?.calculation;
  return <div className="tab-stack">
    <Paragraph type="secondary">Quyết định lương có hiệu lực rơi vào kỳ đã khóa tạo ứng viên hồi tố. Tính lại kỳ gốc bằng công, OT, tham số của kỳ gốc; kỳ đã khóa không đổi, chênh lệch ghi vào kỳ đang mở sau khi xác nhận.</Paragraph>
    <div className="workspace-filters"><label>Trạng thái<Select allowClear value={status} onChange={setStatus} style={{ minWidth: 200 }} options={[{ value: "PENDING", label: "Chờ xử lý" }, { value: "RESOLVED", label: "Đã ghi bút toán" }, { value: "DISMISSED", label: "Bỏ qua" }]} /></label></div>
    {calculate.isError && <Alert type="error" showIcon message="Không tính được chênh lệch" description={errorMessage(calculate.error)} />}
    <Table<RetroCandidateRow> className="workspace-table" rowKey="id" loading={candidates.isLoading} dataSource={candidates.data?.items ?? []} scroll={{ x: 860 }} columns={[
      { title: "Nhân sự", render: (_, row) => <>{row.employee.code}<br /><Text type="secondary">{row.employee.fullName}</Text></> },
      { title: "Quyết định", render: (_, row) => `${row.decision.decisionNumber} (hiệu lực ${row.decision.effectiveFrom})` },
      { title: "Kỳ đã khóa", render: (_, row) => row.payrollPeriod.code },
      { title: "Kết quả tính", render: (_, row) => row.calculation ? <Button size="small" type="link" onClick={() => setCalculationId(row.calculation!.id)}>{row.calculation.status === "CALCULATED" ? "Chờ xác nhận" : row.calculation.status === "CONFIRMED" ? "Đã xác nhận" : "Đã hủy"}</Button> : "—" },
      { title: "", width: 150, render: (_, row) => row.status === "PENDING" && <Button size="small" loading={calculate.isPending && calculate.variables === row.id} onClick={() => calculate.mutate(row.id)}>Tính chênh lệch</Button> },
    ]} />
    <Title level={5}>Bút toán điều chỉnh</Title>
    <Table<PayrollAdjustmentRow> size="small" rowKey="id" loading={adjustments.isLoading} dataSource={adjustments.data?.items ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 860 }} columns={[
      { title: "Loại", dataIndex: "kind", width: 140, render: value => ADJUSTMENT_KIND[value] ?? value }, { title: "Nhân sự", render: (_, row) => `${row.employee.code} ${row.employee.fullName}` },
      { title: "Kỳ gốc", dataIndex: "originPeriod" }, { title: "Vào kỳ", render: (_, row) => row.appliedPeriod ?? row.targetPeriod ?? "Kỳ mở kế tiếp" },
      { title: "Số tiền", dataIndex: "amount", align: "right", render: signed }, { title: "Trạng thái", dataIndex: "status", width: 120, render: (value, row) => row.appliedPeriod ? <Tag color="success">Đã vào lương</Tag> : <Tag>{value === "CONFIRMED" ? "Chờ kỳ lương" : value}</Tag> },
    ]} expandable={{ expandedRowRender: row => <Text type="secondary">{row.explanation}</Text> }} />
    <Drawer open={Boolean(calculationId)} width={900} title={view ? `Bảng chênh lệch hồi tố — ${view.employee.code} ${view.employee.fullName}` : "Bảng chênh lệch hồi tố"} onClose={() => setCalculationId(null)}>
      {calculation.isError && <Alert type="error" showIcon message={errorMessage(calculation.error)} />}
      {view && <div className="tab-stack">
        <Text>Quyết định {view.decision.decisionNumber}, hiệu lực {view.decision.effectiveFrom} · {view.status === "CALCULATED" ? <Tag color="processing">Chờ xác nhận</Tag> : view.status === "CONFIRMED" ? <Tag color="success">Đã xác nhận bởi {view.decidedBy}</Tag> : <Tag>Đã hủy</Tag>}</Text>
        <RetroTable calculation={view} />
        {view.status === "CALCULATED" && <Space wrap align="end">
          <label>Nhập lại mật khẩu để xác nhận<Input.Password autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} style={{ width: 240 }} /></label>
          <Button type="primary" disabled={!password} loading={confirm.isPending} onClick={() => confirm.mutate()}>Xác nhận ghi bút toán</Button>
          <Button loading={discard.isPending} onClick={() => discard.mutate()}>Không xác nhận</Button>
        </Space>}
        {(confirm.isError || discard.isError) && <Alert type="error" showIcon message={errorMessage(confirm.error ?? discard.error)} />}
      </div>}
    </Drawer>
  </div>;
}
