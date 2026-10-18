import { useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import { CalendarOutlined, PlusOutlined } from "@ant-design/icons";
import type { AuthUser, OrgUnit } from "../api/hrtp";
import { organizationApi } from "../api/hrtp";
import { errorMessage } from "../api/client";
import { shiftsApi } from "../api/shifts";
import type { PlanFilters, PlanInput, PlanSlot, PlanStatus, ScheduleEntry, Shift, ShiftInput, ShiftPlan } from "../api/shifts";

const { Title, Paragraph, Text } = Typography;
const statusLabels: Record<PlanStatus, string> = { DRAFT: "Nháp", PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Trả lại", CANCELLED: "Đã hủy" };
const statusColors: Record<PlanStatus, string> = { DRAFT: "default", PENDING: "processing", APPROVED: "success", RETURNED: "warning", CANCELLED: "default" };
const kindLabels: Record<Shift["kind"], string> = { ADMINISTRATIVE: "Hành chính", DAY: "Ca ngày", NIGHT: "Ca đêm" };
const actionLabels: Record<string, string> = { CREATE: "Tạo lịch", UPDATE: "Sửa lịch", SUBMIT: "Gửi duyệt", APPROVE: "Duyệt", RETURN: "Trả lại", CANCEL: "Hủy lịch" };
const timeFormatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const required = [{ required: true, message: "Vui lòng nhập/chọn giá trị." }];

function ScheduleTableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Các lượt phân ca" />;
}

function ScheduleTable({ entries }: { entries: ScheduleEntry[] }) {
  return <Table<ScheduleEntry> components={{ body: { wrapper: ScheduleTableBody } }} rowKey="id" dataSource={entries} size="small" pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 950 }} locale={{ emptyText: <Empty description="Chưa có lịch chính thức trong khoảng ngày này" /> }} columns={[
    { title: "Ngày công", dataIndex: "workDate", width: 120 },
    { title: "Nhân sự", render: (_, row) => <><strong>{row.employee.code}</strong><br />{row.employee.fullName}</> },
    { title: "Ca", render: (_, row) => <>{row.shift.code} · {row.shift.name}{row.shift.crossesMidnight && <><br /><Tag>Qua ngày +1</Tag></>}</> },
    { title: "Bắt đầu (giờ Việt Nam)", render: (_, row) => timeFormatter.format(new Date(row.startAt)), width: 180 },
    { title: "Kết thúc (giờ Việt Nam)", render: (_, row) => timeFormatter.format(new Date(row.endAt)), width: 180 },
    { title: "Giờ chuẩn", align: "right", render: (_, row) => row.workMinutes / 60, width: 95 },
  ]} />;
}

function DefinitionEditor({ shift, units, onClose }: { shift: Shift | null; units: OrgUnit[]; onClose: () => void }) {
  const [form] = Form.useForm<ShiftInput>();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: ShiftInput) => shift ? shiftsApi.updateDefinition(shift.id, { ...payload, revision: shift.revision }) : shiftsApi.createDefinition(payload),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["shifts"] }); onClose(); },
  });
  return <Modal className="shift-modal" title={shift ? "Sửa ca làm việc" : "Thêm ca làm việc"} open onCancel={onClose} footer={null} width={700} destroyOnHidden>
    <Form form={form} name="shift-definition" layout="vertical" requiredMark="optional" initialValues={shift ?? { kind: "DAY", startTime: "06:00", endTime: "14:00", crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: true }} onFinish={values => mutation.mutate(values)} disabled={mutation.isPending}>
      <Form.Item name="orgUnitId" label="Đơn vị áp dụng (được kế thừa xuống đơn vị con)" rules={required}><Select disabled={Boolean(shift)} showSearch optionFilterProp="label" options={units.map(u => ({ value: u.id, label: u.pathLabel }))} /></Form.Item>
      <div className="form-grid">
        <Form.Item name="code" label="Mã ca" rules={[...required, { pattern: /^[A-Z0-9][A-Z0-9_-]{0,31}$/, message: "Tối đa 32 ký tự in hoa, số, _ hoặc -." }]}><Input maxLength={32} /></Form.Item>
        <Form.Item name="name" label="Tên ca" rules={required}><Input maxLength={120} /></Form.Item>
        <Form.Item name="kind" label="Loại ca" rules={required}><Select options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="startTime" label="Giờ bắt đầu" rules={required}><Input type="time" /></Form.Item>
        <Form.Item name="endTime" label="Giờ kết thúc" rules={required}><Input type="time" /></Form.Item>
        <Form.Item name="crossesMidnight" valuePropName="checked" label="Ngày kết thúc"><Checkbox>Kết thúc vào ngày hôm sau</Checkbox></Form.Item>
        <Form.Item name="breakStartOffset" label="Bắt đầu nghỉ sau (phút từ đầu ca)" rules={required}><InputNumber className="full-width" min={0} max={1439} precision={0} /></Form.Item>
        <Form.Item name="breakMinutes" label="Thời gian nghỉ giữa ca (phút)" rules={required}><InputNumber className="full-width" min={0} max={1439} precision={0} /></Form.Item>
      </div>
      <Form.Item name="paidBreak" valuePropName="checked"><Checkbox>Nghỉ giữa ca được tính vào giờ làm việc</Checkbox></Form.Item>
      <Alert type="info" showIcon message="Ca từ 6 giờ: nghỉ ít nhất 30 phút; có giờ đêm: ít nhất 45 phút. Ca đã dùng không được sửa nội dung; hãy tạo mã mới." />
      {mutation.isError && <Alert className="shift-feedback" type="error" showIcon message="Không thể lưu ca" description={errorMessage(mutation.error)} />}
      <div className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu ca</Button></div>
    </Form>
  </Modal>;
}

interface SlotForm extends PlanSlot { mode: "ALL" | "SELECTED" }
interface PlanForm { title: string; teamOrgUnitId: string; slots: SlotForm[] }

function SlotFields({ index, unitId, shifts, remove }: { index: number; unitId?: string; shifts: Shift[]; remove: () => void }) {
  const form = Form.useFormInstance<PlanForm>();
  const workDate = Form.useWatch(["slots", index, "workDate"], form);
  const mode = Form.useWatch(["slots", index, "mode"], form);
  const members = useQuery({ queryKey: ["shifts", "members", unitId, workDate], queryFn: () => shiftsApi.members(unitId!, workDate), enabled: Boolean(unitId && workDate) });
  return <section className="shift-slot" aria-label={"Ngày phân ca " + (index + 1)}>
    <div className="form-grid">
      <Form.Item name={[index, "workDate"]} label="Ngày công (ngày bắt đầu ca)" rules={required}><Input type="date" onChange={() => form.setFieldValue(["slots", index, "employeeIds"], [])} /></Form.Item>
      <Form.Item name={[index, "shiftId"]} label="Ca làm việc" rules={required}><Select showSearch optionFilterProp="label" options={shifts.filter(s => s.active).map(s => ({ value: s.id, label: s.code + " · " + s.name + " (" + s.startTime + "–" + s.endTime + (s.crossesMidnight ? " +1 ngày" : "") + ")" }))} /></Form.Item>
      <Form.Item name={[index, "mode"]} label="Đối tượng" rules={required}><Select options={[{ value: "ALL", label: "Toàn bộ nhân sự được phép xem trong đơn vị" }, { value: "SELECTED", label: "Chọn nhân sự" }]} /></Form.Item>
      {mode === "SELECTED" && <Form.Item name={[index, "employeeIds"]} label="Nhân sự hiệu lực tại ngày này" rules={required}><Select mode="multiple" showSearch optionFilterProp="label" loading={members.isLoading} disabled={!unitId || !workDate || members.isError} options={members.data?.items.map(e => ({ value: e.id, label: e.code + " · " + e.fullName }))} /></Form.Item>}
    </div>
    {mode === "ALL" && members.data && <Paragraph type="secondary">{members.data.items.length} nhân sự trực thuộc đủ điều kiện tại ngày đã chọn. Danh sách được kiểm tra lại khi lưu/gửi/duyệt.</Paragraph>}
    {members.isError && <Alert type="error" showIcon message="Không tải được nhân sự theo ngày" description={errorMessage(members.error)} />}
    <Button danger type="text" onClick={remove}>Bỏ ngày này</Button>
  </section>;
}

function PlanEditor({ plan, units, onClose, onSaved }: { plan: ShiftPlan | null; units: OrgUnit[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [form] = Form.useForm<PlanForm>();
  const unitId = Form.useWatch("teamOrgUnitId", form);
  const client = useQueryClient();
  const definitions = useQuery({ queryKey: ["shifts", "definitions", unitId], queryFn: () => shiftsApi.definitions(unitId), enabled: Boolean(unitId) });
  const grouped = new Map<string, SlotForm>();
  for (const entry of plan?.entries ?? []) {
    const id = entry.workDate + ":" + entry.shift.id;
    const slot = grouped.get(id) ?? { workDate: entry.workDate, shiftId: entry.shift.id, mode: "SELECTED" as const, employeeIds: [] };
    slot.employeeIds!.push(entry.employee.id); grouped.set(id, slot);
  }
  const mutation = useMutation({ mutationFn: (values: PlanForm) => {
    const payload: PlanInput = { title: values.title, teamOrgUnitId: values.teamOrgUnitId, slots: values.slots.map(s => ({ workDate: s.workDate, shiftId: s.shiftId, ...(s.mode === "SELECTED" ? { employeeIds: s.employeeIds } : {}) })) };
    return plan ? shiftsApi.updatePlan(plan.id, { ...payload, revision: plan.revision }) : shiftsApi.createPlan(payload);
  }, onSuccess: ({ plan: saved }) => { void client.invalidateQueries({ queryKey: ["shifts"] }); onClose(); onSaved(saved.id); } });
  return <Modal className="shift-modal" title={plan ? "Sửa lịch nháp / trả lại" : "Lập lịch phân ca"} open onCancel={onClose} footer={null} width={850} destroyOnHidden>
    <Form form={form} name="shift-plan" layout="vertical" requiredMark="optional" disabled={mutation.isPending} initialValues={{ title: plan?.title, teamOrgUnitId: plan?.teamOrgUnitId, slots: plan ? [...grouped.values()] : [{ workDate: today, mode: "ALL" }] }} onFinish={values => mutation.mutate(values)}>
      <Form.Item name="title" label="Tên lịch" rules={required}><Input maxLength={160} /></Form.Item>
      <Form.Item name="teamOrgUnitId" label="Tổ / đơn vị có nhân sự trực thuộc" rules={required}><Select disabled={Boolean(plan)} showSearch optionFilterProp="label" options={units.filter(u => u.type === "TEAM" || u.type === "DEPARTMENT").map(u => ({ value: u.id, label: u.pathLabel }))} onChange={() => { form.setFieldValue("slots", [{ workDate: today, mode: "ALL" }]); }} /></Form.Item>
      <Alert type="info" showIcon message="Tối đa 8 giờ/ngày, 48 giờ/tuần (thứ Hai–Chủ nhật); nghỉ chuyển ca ít nhất 12 giờ. Nháp/chờ duyệt chưa phải lịch chính thức." />
      {definitions.isError && <Alert type="error" message="Không tải được danh mục ca" description={errorMessage(definitions.error)} />}
      <Form.List name="slots" rules={[{ validator: async (_, rows) => { if (!rows?.length) throw new Error("Thêm ít nhất một ngày phân ca."); if (rows.length > 31) throw new Error("Mỗi lịch tối đa 31 dòng ngày/ca."); } }]}>
        {(fields, { add, remove }, { errors }) => <>
          {fields.map(field => <SlotFields key={field.key} index={field.name} unitId={unitId} shifts={definitions.data?.items ?? []} remove={() => remove(field.name)} />)}
          <Form.ErrorList errors={errors} />
          <Button icon={<PlusOutlined />} disabled={!unitId || fields.length >= 31} onClick={() => add({ workDate: today, mode: "ALL" })}>Thêm ngày / ca</Button>
        </>}
      </Form.List>
      {mutation.isError && <Alert className="shift-feedback" type="error" showIcon message="Không thể lưu lịch" description={errorMessage(mutation.error)} />}
      <div className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu nháp</Button></div>
    </Form>
  </Modal>;
}

export function ShiftWorkspace({ user }: { user: AuthUser }) {
  const client = useQueryClient();
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  const [filters, setFilters] = useState<PlanFilters>({ dateFrom: today.slice(0, 7) + "-01", dateTo: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10) });
  const [editor, setEditor] = useState<{ shift: Shift | null } | null>(null);
  const [planEditor, setPlanEditor] = useState<{ plan: ShiftPlan | null } | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [reasonAction, setReasonAction] = useState<"return" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [revisionView, setRevisionView] = useState<ShiftPlan | null>(null);
  const [tab, setTab] = useState(user.permissions.includes("shift.manage") ? "definitions" : "plans");
  const definitions = useQuery({ queryKey: ["shifts", "definitions"], queryFn: () => shiftsApi.definitions() });
  const validRange = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom <= filters.dateTo && Date.parse(filters.dateTo) - Date.parse(filters.dateFrom) <= 92 * 86400000);
  const plans = useQuery({ queryKey: ["shifts", "plans", filters], queryFn: () => shiftsApi.plans(filters), enabled: validRange && tab === "plans" });
  const official = useQuery({ queryKey: ["shifts", "official", filters], queryFn: () => shiftsApi.official(filters), enabled: validRange && tab === "official" });
  const detail = useQuery({ queryKey: ["shifts", "plan", selectedId], queryFn: () => shiftsApi.plan(selectedId!), enabled: Boolean(selectedId) });
  const plan = detail.data?.plan;
  const manage = user.permissions.includes("shift.manage");
  const own = Boolean(plan && plan.createdBy.id === user.id && user.permissions.includes("shift.plan"));
  const canEdit = own && (plan?.status === "DRAFT" || plan?.status === "RETURNED");
  const canReview = Boolean(plan && plan.status === "PENDING" && plan.createdBy.id !== user.id && user.permissions.includes("shift.approve"));
  const active = useMutation({ mutationFn: ({ shift, value }: { shift: Shift; value: boolean }) => shiftsApi.active(shift, value), onSuccess: () => { void client.invalidateQueries({ queryKey: ["shifts"] }); } });
  const action = useMutation({ mutationFn: ({ name, reason }: { name: "submit" | "approve" | "return" | "cancel"; reason?: string }) => shiftsApi.action(plan!.id, name, plan!.revision, reason), onSuccess: () => { setReasonAction(null); setReason(""); void client.invalidateQueries({ queryKey: ["shifts"] }); } });
  const units = context.data?.units ?? [];
  const toolbar = <div className="shift-filters">
    <label>Từ ngày<Input aria-label="Lịch ca từ ngày" type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} /></label>
    <label>Đến ngày<Input aria-label="Lịch ca đến ngày" type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })} /></label>
    <label>Đơn vị<Select className="full-width" aria-label="Lọc đơn vị lịch ca" allowClear showSearch optionFilterProp="label" value={filters.teamOrgUnitId} options={units.filter(u => u.type === "TEAM" || u.type === "DEPARTMENT").map(u => ({ value: u.id, label: u.pathLabel }))} onChange={teamOrgUnitId => setFilters({ ...filters, teamOrgUnitId })} /></label>
    {tab === "plans" && <label>Trạng thái<Select className="full-width" aria-label="Lọc trạng thái lịch ca" allowClear value={filters.status} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} onChange={status => setFilters({ ...filters, status })} /></label>}
  </div>;
  return <div className="content-stack shift-workspace">
    <div className="page-heading"><div><p className="eyebrow">CA LÀM VIỆC / LỊCH ĐƯỢC DUYỆT</p><Title level={1}>Ca & phân ca</Title><Paragraph type="secondary">Một ca thuộc ngày bắt đầu. Mọi thời điểm hiển thị theo giờ Việt Nam.</Paragraph></div>
      <Space wrap>{manage && <Button icon={<PlusOutlined />} onClick={() => setEditor({ shift: null })}>Thêm ca</Button>}{user.permissions.includes("shift.plan") && <Button type="primary" icon={<CalendarOutlined />} onClick={() => setPlanEditor({ plan: null })}>Lập lịch phân ca</Button>}</Space>
    </div>
    {context.isError && <Alert type="error" showIcon message="Không tải được phạm vi đơn vị" description={errorMessage(context.error)} />}
    <section className="panel settings-panel"><Tabs activeKey={tab} onChange={setTab} items={[
      { key: "definitions", label: "Danh mục ca", children: <div className="tab-stack">
        {definitions.isError && <Alert type="error" showIcon message="Không tải được danh mục ca" description={errorMessage(definitions.error)} />}
        {active.isError && <Alert type="error" showIcon message="Không thể đổi trạng thái ca" description={errorMessage(active.error)} />}
        <Table<Shift> rowKey="id" size="small" loading={definitions.isLoading} dataSource={definitions.data?.items ?? []} scroll={{ x: 1000 }} locale={{ emptyText: <Empty description="Chưa khai báo ca trong phạm vi. Quản trị viên có thể thêm ca." /> }} columns={[
          { title: "Mã / tên ca", render: (_, row) => <><strong>{row.code}</strong><br />{row.name}</> },
          { title: "Đơn vị áp dụng", render: (_, row) => units.find(u => u.id === row.orgUnitId)?.name ?? "Kế thừa từ đơn vị cấp trên" },
          { title: "Loại", render: (_, row) => kindLabels[row.kind] },
          { title: "Khung giờ", render: (_, row) => <>{row.startTime} → {row.endTime}{row.crossesMidnight && <><br /><Tag>Ngày hôm sau +1</Tag></>}</> },
          { title: "Nghỉ giữa ca", render: (_, row) => <>{row.breakMinutes} phút sau {row.breakStartOffset} phút<br /><Text type="secondary">{row.paidBreak ? "Tính vào giờ làm" : "Không tính giờ làm"}</Text></> },
          { title: "Giờ chuẩn", align: "right", render: (_, row) => row.workMinutes / 60 },
          { title: "Trạng thái", render: (_, row) => <Tag color={row.active ? "success" : "default"}>{row.active ? "Đang dùng" : "Ngừng dùng"}</Tag> },
          ...(manage ? [{ title: "Thao tác", render: (_: unknown, row: Shift) => <Space><Button size="small" onClick={() => setEditor({ shift: row })}>Sửa</Button><Popconfirm title={row.active ? "Ngừng dùng ca cho lịch mới?" : "Cho phép dùng lại ca?"} onConfirm={() => active.mutateAsync({ shift: row, value: !row.active }).then(() => undefined).catch(() => undefined)}><Button size="small" disabled={active.isPending}>{row.active ? "Ngừng dùng" : "Dùng lại"}</Button></Popconfirm></Space> }] : []),
        ]} />
      </div> },
      { key: "plans", label: "Lập & duyệt", children: <div className="tab-stack">{toolbar}
        {!validRange && <Alert type="warning" message="Chọn khoảng ngày hợp lệ, tối đa 93 ngày." />}
        {plans.isError && <Alert type="error" showIcon message="Không tải được lịch phân ca" description={errorMessage(plans.error)} />}
        <Table rowKey="id" loading={plans.isLoading} dataSource={plans.data?.items ?? []} scroll={{ x: 950 }} locale={{ emptyText: <Empty description="Chưa có lịch trong khoảng ngày và phạm vi đã chọn" /> }} columns={[
          { title: "Lịch", render: (_, row) => <Button type="link" onClick={() => { action.reset(); setSelectedId(row.id); }}>{row.title}</Button> },
          { title: "Đơn vị", dataIndex: "teamOrgUnitCode" },
          { title: "Ngày công", render: (_, row) => row.dateFrom + " → " + row.dateTo },
          { title: "Lượt phân ca", dataIndex: "entryCount", align: "right" },
          { title: "Người lập", render: (_, row) => row.createdBy.displayName },
          { title: "Trạng thái", render: (_, row) => <Tag color={statusColors[row.status]}>{statusLabels[row.status]}</Tag> },
        ]} />
      </div> },
      { key: "official", label: "Chính thức", children: <div className="tab-stack">{toolbar}<Alert type="success" showIcon message="Chỉ hiển thị lịch đã được QĐ duyệt; không lấy lịch nháp, chờ duyệt hoặc trả lại." />
        {!validRange && <Alert type="warning" message="Chọn khoảng ngày hợp lệ, tối đa 93 ngày." />}
        {official.isError ? <Alert type="error" message="Không tải được lịch chính thức" description={errorMessage(official.error)} /> : official.isLoading ? <Spin /> : <ScheduleTable entries={official.data?.items ?? []} />}
      </div> },
    ]} /></section>
    {editor && <DefinitionEditor shift={editor.shift} units={units} onClose={() => setEditor(null)} />}
    {planEditor && <PlanEditor plan={planEditor.plan} units={units} onClose={() => setPlanEditor(null)} onSaved={id => { action.reset(); setSelectedId(id); setTab("plans"); }} />}
    <Modal className="shift-modal" title={plan?.title ?? "Chi tiết lịch phân ca"} open={Boolean(selectedId)} onCancel={() => { setSelectedId(undefined); setRevisionView(null); }} footer={null} width={1100} destroyOnHidden>
      {detail.isLoading ? <Spin /> : detail.isError ? <Alert type="error" showIcon message="Không tải được lịch" description={errorMessage(detail.error)} /> : plan && <div className="tab-stack">
        <Descriptions size="small" items={[{ key: "unit", label: "Đơn vị", children: plan.teamOrgUnitCode }, { key: "status", label: "Trạng thái", children: <Tag color={statusColors[plan.status]}>{statusLabels[plan.status]}</Tag> }, { key: "revision", label: "Phiên bản", children: plan.revision }]} />
        <Space wrap>{canEdit && <><Button onClick={() => { setSelectedId(undefined); setPlanEditor({ plan }); }}>Sửa lịch</Button><Popconfirm title="Gửi lịch cho QĐ duyệt?" onConfirm={() => action.mutate({ name: "submit" })}><Button type="primary" loading={action.isPending}>Gửi duyệt</Button></Popconfirm></>}
          {canReview && <><Popconfirm title="Duyệt lịch này thành lịch chính thức?" onConfirm={() => action.mutate({ name: "approve" })}><Button type="primary" loading={action.isPending}>Duyệt lịch</Button></Popconfirm><Button disabled={action.isPending} onClick={() => { setReason(""); setReasonAction("return"); }}>Trả lại</Button></>}
          {own && plan.status !== "APPROVED" && plan.status !== "CANCELLED" && <Button danger disabled={action.isPending} onClick={() => { setReason(""); setReasonAction("cancel"); }}>Hủy lịch</Button>}
        </Space>
        {action.isError && <Alert type="error" showIcon message="Không thể chuyển trạng thái lịch" description={errorMessage(action.error)} />}
        <Tabs items={[{ key: "entries", label: "Các lượt phân ca", children: <ScheduleTable entries={plan.entries} /> }, { key: "history", label: "Lịch sử thao tác", children: <div className="tab-stack">
          <Table rowKey="id" size="small" dataSource={detail.data?.history ?? []} scroll={{ x: 700 }} columns={[
            { title: "Thời điểm", render: (_, row) => timeFormatter.format(new Date(row.occurredAt)) }, { title: "Người thao tác", render: (_, row) => row.actor.displayName },
            { title: "Hành động", render: (_, row) => actionLabels[row.action] ?? row.action }, { title: "Trạng thái sau", render: (_, row) => statusLabels[row.toStatus] },
            { title: "Lý do", dataIndex: "reason" }, { title: "Phiên bản", render: (_, row) => <Button type="link" onClick={() => setRevisionView(row.snapshot)}>Xem bản {row.revision}</Button> },
          ]} />
          {revisionView && <><Title level={4}>Phiên bản {revisionView.revision} · {statusLabels[revisionView.status]}</Title><ScheduleTable entries={revisionView.entries} /></>}
        </div> }]} />
      </div>}
    </Modal>
    <Modal title={reasonAction === "return" ? "Trả lại lịch phân ca" : "Hủy lịch phân ca"} open={Boolean(reasonAction)} onCancel={() => setReasonAction(null)} footer={null} destroyOnHidden>
      <Form name="shift-action" layout="vertical" onFinish={() => action.mutate({ name: reasonAction!, reason })}><Form.Item label="Lý do" required validateStatus={!reason.trim() ? "warning" : undefined} help={!reason.trim() ? "Lý do là bắt buộc." : undefined}><Input.TextArea aria-label="Lý do trả lại hoặc hủy lịch" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} rows={4} /></Form.Item>
        {action.isError && <Alert type="error" message={errorMessage(action.error)} />}
        <div className="modal-actions"><Button onClick={() => setReasonAction(null)}>Đóng</Button><Button type="primary" htmlType="submit" loading={action.isPending} disabled={!reason.trim()}>Xác nhận</Button></div>
      </Form>
    </Modal>
  </div>;
}
