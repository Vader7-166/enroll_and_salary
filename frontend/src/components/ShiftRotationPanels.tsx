import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, ApiError } from "../api/client";
import type { AuthUser, OrgUnit } from "../api/hrtp";
import { rotationApi, shiftsApi } from "../api/shifts";
import type { RotationPattern, Shift, ShiftPlan, ShiftSwap } from "../api/shifts";

const { Text } = Typography;
const SWAP: Record<ShiftSwap["status"], [string, string]> = { PENDING: ["Chờ duyệt", "gold"], APPROVED: ["Đã duyệt", "success"], RETURNED: ["Trả lại", "orange"], REJECTED: ["Từ chối", "red"], CANCELLED: ["Đã hủy", "default"] };

/** Lists every rest/constraint violation returned by the API instead of only the first message. */
function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof ApiError ? error.details as { violations?: Array<{ workDate: string; previousDate: string; gapMinutes: number }> } | undefined : undefined;
  return <Alert type="error" showIcon message={errorMessage(error)} description={details?.violations?.map(row => row.previousDate + " → " + row.workDate + ": nghỉ " + Math.round(row.gapMinutes / 60) + " giờ").join("; ")} />;
}

export function RotationPatternsTab({ canManage, units, shifts }: { canManage: boolean; units: OrgUnit[]; shifts: Shift[] }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const patterns = useQuery({ queryKey: ["shifts", "patterns"], queryFn: rotationApi.patterns });
  const create = useMutation({ mutationFn: rotationApi.createPattern, onSuccess: () => { setOpen(false); form.resetFields(); void client.invalidateQueries({ queryKey: ["shifts", "patterns"] }); } });
  const codeOf = (id: string | null) => id ? shifts.find(shift => shift.id === id)?.code ?? "?" : "Nghỉ";
  return <div className="tab-stack">
    {canManage && <div><Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>Thêm mẫu xoay ca</Button></div>}
    {patterns.isError && <Alert type="error" showIcon message="Không tải được mẫu xoay ca" description={errorMessage(patterns.error)} />}
    <Table<RotationPattern> rowKey="id" size="small" loading={patterns.isLoading} dataSource={patterns.data?.items ?? []} pagination={false} scroll={{ x: 800 }} locale={{ emptyText: <Empty description="Chưa có mẫu xoay ca" /> }} columns={[
      { title: "Mẫu", render: (_, row) => <>{row.versions[0]?.name}<small className="table-subtext">{row.code} · {row.siteCode}</small></> },
      { title: "Chu kỳ", render: (_, row) => row.versions[0] ? row.versions[0].cycleDays + " ngày: " + row.versions[0].sequence.map(codeOf).join(" – ") : "—" },
      { title: "Nghỉ tối thiểu", width: 140, render: (_, row) => row.versions[0] ? row.versions[0].minRestMinutes / 60 + " giờ" : "—" },
      { title: "Hiệu lực", width: 200, render: (_, row) => row.versions[0] ? row.versions[0].effectiveFrom + " → " + (row.versions[0].effectiveTo ?? "…") : "—" },
    ]} />
    <Modal title="Thêm mẫu xoay ca" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden width={640}>
      <Form form={form} layout="vertical" requiredMark="optional" initialValues={{ minRestMinutes: 720, sequence: [undefined] }}
        onFinish={values => create.mutate({ ...values, sequence: (values.sequence as Array<string | undefined>).map(item => item && item !== "REST" ? item : null) })}>
        <div className="form-grid">
          <Form.Item name="siteOrgUnitId" label="Cơ sở" rules={[{ required: true }]}><Select options={units.filter(unit => unit.type === "SITE").map(unit => ({ value: unit.id, label: unit.pathLabel }))} /></Form.Item>
          <Form.Item name="code" label="Mã" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="name" label="Tên" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
          <Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="minRestMinutes" label="Nghỉ tối thiểu giữa hai ca (phút)"><InputNumber min={0} max={2880} className="full-width" /></Form.Item>
        </div>
        <Form.List name="sequence">{(fields, { add, remove }) => <div className="tab-stack">
          <Text>Thứ tự trong chu kỳ</Text>
          {fields.map((field, index) => <Space key={field.key}><Text>Ngày {index + 1}</Text><Form.Item {...field} noStyle><Select style={{ minWidth: 220 }} placeholder="Ngày nghỉ" options={[{ value: "REST", label: "Ngày nghỉ" }, ...shifts.filter(shift => shift.active).map(shift => ({ value: shift.id, label: shift.code + " — " + shift.name }))]} /></Form.Item><Button size="small" onClick={() => remove(field.name)}>Bỏ</Button></Space>)}
          <Button size="small" onClick={() => add()}>Thêm ngày</Button>
        </div>}</Form.List>
        <Problem error={create.error} />
        <Space className="modal-actions"><Button onClick={() => setOpen(false)}>Hủy</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Lưu mẫu</Button></Space>
      </Form>
    </Modal>
  </div>;
}

/** TT tools on a DRAFT/RETURNED plan: fill from a rotation pattern or assign one shift to many people/days. */
export function PlanTools({ plan, shifts, onSaved }: { plan: ShiftPlan; shifts: Shift[]; onSaved: () => void }) {
  const [mode, setMode] = useState<"generate" | "bulk" | null>(null);
  const [form] = Form.useForm();
  const patterns = useQuery({ queryKey: ["shifts", "patterns"], queryFn: rotationApi.patterns, enabled: mode === "generate" });
  const members = [...new Map(plan.entries.map(entry => [entry.employee.id, entry.employee])).values()];
  const firstDay = plan.entries[0]?.workDate;
  const people = useQuery({ queryKey: ["shifts", "members", plan.teamOrgUnitId, firstDay], queryFn: () => shiftsApi.members(plan.teamOrgUnitId, firstDay!), enabled: Boolean(mode && firstDay) });
  const options = [...new Map([...members, ...(people.data?.items ?? [])].map(member => [member.id, member])).values()].map(member => ({ value: member.id, label: member.code + " — " + member.fullName }));
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>): Promise<{ plan: ShiftPlan }> => mode === "generate"
      ? rotationApi.generate(plan.id, { revision: plan.revision, patternId: values.patternId, dateFrom: values.dateFrom, dateTo: values.dateTo, members: (values.employeeIds as string[]).map((employeeId, index) => ({ employeeId, cycleOffset: ((values.offsetStep as number) ?? 0) * index })) })
      : rotationApi.bulkAssign(plan.id, { revision: plan.revision, shiftId: values.shiftId, employeeIds: values.employeeIds, dates: String(values.dates).split(/[\s,;]+/).filter(Boolean) }),
    onSuccess: () => { setMode(null); form.resetFields(); onSaved(); },
  });
  return <>
    <Button onClick={() => setMode("generate")}>Sinh theo mẫu xoay ca</Button><Button onClick={() => setMode("bulk")}>Phân ca hàng loạt</Button>
    <Modal title={mode === "generate" ? "Sinh lịch theo mẫu xoay ca" : "Phân ca hàng loạt"} open={Boolean(mode)} onCancel={() => setMode(null)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={values => save.mutate(values)} initialValues={{ offsetStep: 0 }}>
        {mode === "generate" ? <>
          <Form.Item name="patternId" label="Mẫu" rules={[{ required: true }]}><Select loading={patterns.isLoading} options={patterns.data?.items.map(item => ({ value: item.id, label: item.versions[0]?.name + " (" + item.code + ")" }))} /></Form.Item>
          <div className="form-grid"><Form.Item name="dateFrom" label="Từ ngày" rules={[{ required: true }]}><Input type="date" /></Form.Item><Form.Item name="dateTo" label="Đến ngày" rules={[{ required: true }]}><Input type="date" /></Form.Item></div>
          <Form.Item name="offsetStep" label="Lệch chu kỳ giữa hai người liên tiếp (ngày)" extra="0: cùng điểm bắt đầu; 2: người sau bắt đầu chu kỳ muộn hơn 2 ngày."><InputNumber min={0} max={61} /></Form.Item>
        </> : <>
          <Form.Item name="shiftId" label="Ca" rules={[{ required: true }]}><Select options={shifts.filter(shift => shift.active).map(shift => ({ value: shift.id, label: shift.code + " — " + shift.name }))} /></Form.Item>
          <Form.Item name="dates" label="Các ngày (cách nhau bởi dấu phẩy)" rules={[{ required: true }]}><Input placeholder="2026-11-12, 2026-11-13" /></Form.Item>
        </>}
        <Form.Item name="employeeIds" label="Nhân sự" rules={[{ required: true }]}><Select mode="multiple" loading={people.isLoading} options={options} /></Form.Item>
        <Problem error={save.error} />
        <Space className="modal-actions"><Button onClick={() => setMode(null)}>Hủy</Button><Button type="primary" htmlType="submit" loading={save.isPending}>Áp dụng vào lịch nháp</Button></Space>
      </Form>
    </Modal>
  </>;
}

export function CopyPreviousButton({ units, onCreated }: { units: OrgUnit[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [form] = Form.useForm();
  const mode = Form.useWatch("mode", form);
  const copy = useMutation({ mutationFn: rotationApi.copyPrevious, onSuccess: data => { setResult(data.skipped.length ? "Bỏ qua " + data.skipped.map(row => row.code).join(", ") + " (không còn thuộc đơn vị/đã nghỉ)." : null); if (!data.skipped.length) setOpen(false); onCreated(data.plan.id); } });
  return <>
    <Button onClick={() => { setResult(null); setOpen(true); }}>Sao chép lịch kỳ trước</Button>
    <Modal title="Sao chép lịch đã duyệt của kỳ trước" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ mode: "WEEKDAY" }} onFinish={values => copy.mutate(values)}>
        <Form.Item name="teamOrgUnitId" label="Đơn vị" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={units.filter(unit => unit.type === "TEAM" || unit.type === "DEPARTMENT").map(unit => ({ value: unit.id, label: unit.pathLabel }))} /></Form.Item>
        <Form.Item name="title" label="Tên lịch mới" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <div className="form-grid">
          <Form.Item name="sourceFrom" label="Kỳ nguồn từ" rules={[{ required: true }]}><Input type="date" /></Form.Item><Form.Item name="sourceTo" label="Kỳ nguồn đến" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="targetFrom" label="Kỳ mới từ" rules={[{ required: true }]}><Input type="date" /></Form.Item><Form.Item name="targetTo" label="Kỳ mới đến" rules={[{ required: true }]}><Input type="date" /></Form.Item>
        </div>
        <Form.Item name="mode" label="Căn ngày"><Radio.Group options={[{ value: "WEEKDAY", label: "Theo thứ trong tuần" }, { value: "CYCLE", label: "Theo chu kỳ" }]} /></Form.Item>
        {mode === "CYCLE" && <Form.Item name="cycleDays" label="Số ngày chu kỳ" rules={[{ required: true }]}><InputNumber min={1} max={62} /></Form.Item>}
        <Problem error={copy.error} />
        {result && <Alert type="warning" showIcon message={result} />}
        <Space className="modal-actions"><Button onClick={() => setOpen(false)}>Đóng</Button><Button type="primary" htmlType="submit" loading={copy.isPending}>Tạo lịch nháp</Button></Space>
      </Form>
    </Modal>
  </>;
}

/** TT proposes from an approved schedule row; QĐ approves in one click (or returns/rejects with a reason). */
export function SwapsTab({ user, shifts, official }: { user: AuthUser; shifts: Shift[]; official: Array<{ id: string; workDate: string; employee: { id: string; code: string; fullName: string }; shift: { id: string; code: string } }> }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<string | undefined>("PENDING");
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ swap: ShiftSwap; action: "return" | "reject" } | null>(null);
  const [reason, setReason] = useState("");
  const [form] = Form.useForm();
  const swaps = useQuery({ queryKey: ["shifts", "swaps", status], queryFn: () => rotationApi.swaps(status) });
  const refresh = () => void client.invalidateQueries({ queryKey: ["shifts"] });
  const create = useMutation({ mutationFn: rotationApi.createSwap, onSuccess: () => { setCreating(false); form.resetFields(); refresh(); } });
  const decide = useMutation({ mutationFn: ({ swap, action, reason }: { swap: ShiftSwap; action: "approve" | "return" | "reject"; reason?: string }) => rotationApi.decide(swap, action, reason), onSuccess: () => { setDeciding(null); setReason(""); refresh(); } });
  const canPlan = user.permissions.includes("shift.plan"), canApprove = user.permissions.includes("shift.approve");
  return <div className="tab-stack">
    <Space wrap>{canPlan && <Button type="primary" onClick={() => setCreating(true)}>Đề xuất đổi ca</Button>}
      <Select allowClear placeholder="Mọi trạng thái" value={status} onChange={setStatus} style={{ minWidth: 180 }} options={Object.entries(SWAP).map(([value, [label]]) => ({ value, label }))} /></Space>
    <Alert type="info" showIcon message="Khi chưa được duyệt, lịch đã duyệt hiện hành vẫn được dùng để ghép công. Duyệt cập nhật lịch có lịch sử và ghép lại công ngày đó nếu kỳ công còn mở." />
    <Problem error={swaps.error ?? decide.error} />
    <Table<ShiftSwap> rowKey="id" size="small" loading={swaps.isLoading} dataSource={swaps.data?.items ?? []} pagination={false} scroll={{ x: 1000 }} locale={{ emptyText: <Empty description="Không có đề xuất đổi ca" /> }} columns={[
      { title: "Nhân sự", render: (_, row) => <>{row.employee.fullName}<small className="table-subtext">{row.employee.code} · {row.teamCode}</small></> },
      { title: "Ngày", dataIndex: "workDate", width: 110 },
      { title: "Đổi ca", width: 220, render: (_, row) => row.oldShift.code + " (" + row.oldShift.startTime + "–" + row.oldShift.endTime + ") → " + row.newShift.code + " (" + row.newShift.startTime + "–" + row.newShift.endTime + ")" },
      { title: "Lý do", dataIndex: "reason" },
      { title: "Trạng thái", width: 130, render: (_, row) => <Tag color={SWAP[row.status][1]}>{SWAP[row.status][0]}</Tag> },
      ...(canApprove ? [{ title: "", width: 230, render: (_: unknown, row: ShiftSwap) => row.status === "PENDING" && row.createdBy.id !== user.id && <Space>
        <Button size="small" type="primary" loading={decide.isPending} onClick={() => decide.mutate({ swap: row, action: "approve" })}>Duyệt</Button>
        <Button size="small" onClick={() => setDeciding({ swap: row, action: "return" })}>Trả lại</Button><Button size="small" danger onClick={() => setDeciding({ swap: row, action: "reject" })}>Từ chối</Button></Space> }] : []),
    ]} />
    <Modal title="Đề xuất đổi ca" open={creating} onCancel={() => setCreating(false)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={values => create.mutate(values)}>
        <Form.Item name="scheduleId" label="Lượt phân ca đã duyệt" rules={[{ required: true }]} extra="Danh sách lấy từ tab Chính thức theo khoảng ngày đang chọn.">
          <Select showSearch optionFilterProp="label" options={official.map(row => ({ value: row.id, label: row.workDate + " · " + row.employee.code + " " + row.employee.fullName + " · " + row.shift.code }))} /></Form.Item>
        <Form.Item name="newShiftId" label="Ca mới" rules={[{ required: true }]}><Select options={shifts.filter(shift => shift.active).map(shift => ({ value: shift.id, label: shift.code + " — " + shift.name + " (" + shift.startTime + "–" + shift.endTime + ")" }))} /></Form.Item>
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item>
        <Problem error={create.error} />
        <Space className="modal-actions"><Button onClick={() => setCreating(false)}>Hủy</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Gửi đề xuất</Button></Space>
      </Form>
    </Modal>
    <Modal title={deciding?.action === "return" ? "Trả lại đề xuất" : "Từ chối đề xuất"} open={Boolean(deciding)} onCancel={() => setDeciding(null)} okText="Xác nhận" okButtonProps={{ disabled: !reason.trim(), loading: decide.isPending }} onOk={() => decide.mutate({ swap: deciding!.swap, action: deciding!.action, reason })}>
      <Input.TextArea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Lý do" />
    </Modal>
  </div>;
}
