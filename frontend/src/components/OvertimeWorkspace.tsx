import { CheckOutlined, CloseOutlined, EditOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import type { AuthUser } from "../api/hrtp";
import { errorMessage } from "../api/client";
import { overtimeApi } from "../api/overtime";
import type { OvertimeAction, OvertimeFilters, OvertimeHistory, OvertimeInput, OvertimeSnapshot, OvertimeStatus } from "../api/overtime";

const { Title, Paragraph, Text } = Typography;
const required = [{ required: true, message: "Trường này là bắt buộc." }];

const statusLabels: Record<OvertimeStatus, string> = {
  DRAFT: "Nháp", PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Trả lại", REJECTED: "Từ chối", CANCELLED: "Đã hủy",
};
const statusColors: Record<OvertimeStatus, string> = {
  DRAFT: "default", PENDING: "processing", APPROVED: "success", RETURNED: "warning", REJECTED: "error", CANCELLED: "default",
};

function vietnamToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function defaultFilters(): OvertimeFilters {
  const date = vietnamToday();
  const [year, month] = date.split("-").map(Number);
  return { dateFrom: `${year}-${String(month).padStart(2, "0")}-01`, dateTo: `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}` };
}

function vietnamDateTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value));
}

function formatHours(minutes: number): string {
  return `${(minutes / 60).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} giờ`;
}

function toVietnamOffset(value: string): string {
  return `${value.slice(0, 16)}:00+07:00`;
}

function toVietnamInput(value: string): string {
  return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16);
}

interface OvertimeFormValues {
  teamOrgUnitId: string;
  title: string;
  workDate: string;
  startAt: string;
  endAt: string;
  reason: string;
  employeeIds: string[];
  consents: Record<string, string>;
}

function RequestEditor({ request, onClose }: { request: OvertimeSnapshot | null; onClose: () => void }) {
  const [form] = Form.useForm<OvertimeFormValues>();
  const client = useQueryClient();
  const unitId = Form.useWatch("teamOrgUnitId", form);
  const workDate = Form.useWatch("workDate", form);
  const employeeIds = Form.useWatch("employeeIds", form) ?? [];
  const context = useQuery({ queryKey: ["overtime", "context"], queryFn: overtimeApi.context });
  const members = useQuery({
    queryKey: ["overtime", "members", unitId, workDate],
    queryFn: () => overtimeApi.members(unitId!, workDate!),
    enabled: Boolean(unitId && workDate),
  });
  const mutation = useMutation({
    mutationFn: (values: OvertimeFormValues) => {
      const payload: OvertimeInput = {
        teamOrgUnitId: values.teamOrgUnitId,
        title: values.title.trim(),
        workDate: values.workDate,
        startAt: toVietnamOffset(values.startAt),
        endAt: toVietnamOffset(values.endAt),
        reason: values.reason.trim(),
        members: values.employeeIds.map((employeeId) => ({ employeeId, consentReference: values.consents[employeeId].trim() })),
      };
      if (Date.parse(payload.endAt) <= Date.parse(payload.startAt)) throw new Error("Thời điểm kết thúc phải sau thời điểm bắt đầu.");
      return request ? overtimeApi.update(request.id, { ...payload, revision: request.revision }) : overtimeApi.create(payload);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["overtime"] });
      form.resetFields();
      onClose();
    },
  });
  const initialValues: OvertimeFormValues | undefined = request ? {
    teamOrgUnitId: request.teamOrgUnitId,
    title: request.title,
    workDate: request.workDate,
    startAt: toVietnamInput(request.startAt),
    endAt: toVietnamInput(request.endAt),
    reason: request.reason,
    employeeIds: request.members.map(({ employee }) => employee.id),
    consents: Object.fromEntries(request.members.map(({ employee, consentReference }) => [employee.id, consentReference])),
  } : undefined;
  return <Modal className="overtime-modal" title={request ? "Sửa đề nghị tăng ca" : "Lập đề nghị tăng ca"} open onCancel={onClose} footer={null} width={800} destroyOnHidden>
    <Form
      form={form}
      layout="vertical"
      requiredMark="optional"
      initialValues={initialValues}
      disabled={mutation.isPending}
      onValuesChange={(changed) => {
        if ("teamOrgUnitId" in changed || "workDate" in changed) form.setFieldsValue({ employeeIds: [], consents: {} });
        if ("employeeIds" in changed) {
          const selected = changed.employeeIds as string[];
          const consents = form.getFieldValue("consents") ?? {};
          form.setFieldValue("consents", Object.fromEntries(selected.map((id) => [id, consents[id] ?? ""])));
        }
      }}
      onFinish={(values) => mutation.mutate(values)}
    >
      <Alert type="info" showIcon message="Thời gian bắt đầu và kết thúc được ghi nhận theo giờ Việt Nam (UTC+07:00)." />
      <div className="form-grid overtime-form-grid">
        <Form.Item name="teamOrgUnitId" label="Đơn vị / tổ" rules={required}><Select loading={context.isLoading} options={context.data?.units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} /></Form.Item>
        <Form.Item name="workDate" label="Ngày tăng ca" rules={required}><Input type="date" /></Form.Item>
        <Form.Item name="title" label="Tiêu đề đề nghị" rules={required}><Input maxLength={160} /></Form.Item>
        <Form.Item name="startAt" label="Bắt đầu (giờ Việt Nam)" rules={required}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="endAt" label="Kết thúc (giờ Việt Nam)" rules={required}><Input type="datetime-local" /></Form.Item>
      </div>
      <Form.Item name="reason" label="Lý do tăng ca" rules={required}><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
      <Form.Item name="employeeIds" label="Nhân sự tham gia" rules={[{ required: true, type: "array", min: 1, message: "Chọn ít nhất một nhân sự." }]}>
        <Select mode="multiple" showSearch optionFilterProp="label" loading={members.isLoading} disabled={!unitId || !workDate} options={members.data?.items.map((member) => ({ value: member.id, label: `${member.code} — ${member.fullName}` }))} />
      </Form.Item>
      {members.isError && <Alert type="error" showIcon message="Không tải được nhân sự theo đơn vị và ngày" description={errorMessage(members.error)} />}
      {employeeIds.length > 0 && <section className="overtime-consents" aria-label="Chứng từ đồng ý làm thêm">
        <Text strong>Chứng từ đồng ý làm thêm</Text>
        <Paragraph type="secondary">Mỗi nhân sự phải có mã tham chiếu chứng từ đồng ý hợp lệ; hệ thống không tự điền chứng từ.</Paragraph>
        {employeeIds.map((id) => {
          const member = members.data?.items.find((item) => item.id === id) ?? request?.members.find((item) => item.employee.id === id)?.employee;
          return <Form.Item key={id} name={["consents", id]} label={member ? `${member.code} — ${member.fullName}` : id} rules={required}>
            <Input placeholder="Mã/tài liệu chứng từ đồng ý" maxLength={200} />
          </Form.Item>;
        })}
      </section>}
      {mutation.isError && <Alert className="overtime-feedback" type="error" showIcon message="Không thể lưu đề nghị" description={errorMessage(mutation.error)} />}
      <div className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu đề nghị</Button></div>
    </Form>
  </Modal>;
}

function RequestDetail({ id, user, canApprove, onClose, onEdit }: { id: string; user: AuthUser; canApprove: boolean; onClose: () => void; onEdit: (request: OvertimeSnapshot) => void }) {
  const client = useQueryClient();
  const [actionForm] = Form.useForm<{ reason?: string }>();
  const [pendingAction, setPendingAction] = useState<OvertimeAction | null>(null);
  const [snapshot, setSnapshot] = useState<OvertimeSnapshot | null>(null);
  const [detailTab, setDetailTab] = useState("summary");
  const detail = useQuery({ queryKey: ["overtime", "request", id], queryFn: () => overtimeApi.request(id) });
  const actionMutation = useMutation({
    mutationFn: ({ action, reason }: { action: OvertimeAction; reason?: string }) => overtimeApi.action(id, action.toLowerCase() as Lowercase<OvertimeAction>, detail.data!.request.revision, reason?.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["overtime"] });
      actionForm.resetFields();
      setPendingAction(null);
      onClose();
    },
  });
  if (detail.isLoading) return <Modal title="Chi tiết đề nghị tăng ca" open onCancel={onClose} footer={null}><div className="workspace-loading"><Spin /> Đang tải chi tiết…</div></Modal>;
  if (detail.isError || !detail.data) return <Modal title="Chi tiết đề nghị tăng ca" open onCancel={onClose} footer={null}><Alert type="error" showIcon message="Không tải được chi tiết" description={detail.isError ? errorMessage(detail.error) : undefined} /></Modal>;
  const current = snapshot ?? detail.data.request;
  const isCreator = detail.data.request.createdBy.id === user.id;
  const canEdit = isCreator && ["DRAFT", "RETURNED"].includes(detail.data.request.status);
  const canCancel = isCreator && ["DRAFT", "RETURNED", "PENDING"].includes(detail.data.request.status);
  const canReview = canApprove && !isCreator && detail.data.request.status === "PENDING";
  const actionLabel: Record<OvertimeHistory["action"], string> = { CREATE: "Tạo đề nghị", UPDATE: "Sửa đề nghị", SUBMIT: "Gửi duyệt", APPROVE: "Duyệt đề nghị", RETURN: "Trả lại", REJECT: "Từ chối", CANCEL: "Hủy đề nghị" };
  const reasonRequired = pendingAction === "RETURN" || pendingAction === "REJECT" || pendingAction === "CANCEL";
  const requestColumns: ColumnsType<OvertimeHistory> = [
    { title: "Thời điểm", dataIndex: "occurredAt", width: 160, render: vietnamDateTime },
    { title: "Thao tác", dataIndex: "action", width: 110, render: (action: OvertimeHistory["action"]) => actionLabel[action] },
    { title: "Người thực hiện", dataIndex: ["actor", "displayName"] },
    { title: "Trạng thái", render: (_, row) => <>{row.fromStatus && <Tag color={statusColors[row.fromStatus]}>{statusLabels[row.fromStatus]}</Tag>} → <Tag color={statusColors[row.toStatus]}>{statusLabels[row.toStatus]}</Tag></> },
    { title: "Lý do", dataIndex: "reason", ellipsis: true },
    { title: "Snapshot", width: 110, render: (_, row) => <Button type="link" onClick={() => { setSnapshot(row.snapshot); setDetailTab("summary"); }}>Xem bản ghi</Button> },
  ];
  const summary = <>
    {snapshot && <Alert className="overtime-feedback" type="info" showIcon message="Đang xem snapshot lịch sử" action={<Button size="small" onClick={() => setSnapshot(null)}>Về bản hiện tại</Button>} />}
    <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
      <Descriptions.Item label="Trạng thái"><Tag color={statusColors[current.status]}>{statusLabels[current.status]}</Tag></Descriptions.Item>
      <Descriptions.Item label="Phiên bản">{current.revision}</Descriptions.Item>
      <Descriptions.Item label="Đơn vị">{current.teamOrgUnitCode}</Descriptions.Item>
      <Descriptions.Item label="Người lập">{current.createdBy.displayName}</Descriptions.Item>
      <Descriptions.Item label="Ngày tăng ca">{current.workDate}</Descriptions.Item>
      <Descriptions.Item label="Thời lượng yêu cầu">{formatHours(current.requestedMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Bắt đầu">{vietnamDateTime(current.startAt)} (UTC+07:00)</Descriptions.Item>
      <Descriptions.Item label="Kết thúc">{vietnamDateTime(current.endAt)} (UTC+07:00)</Descriptions.Item>
      <Descriptions.Item label="Tiêu đề" span={2}>{current.title}</Descriptions.Item>
      <Descriptions.Item label="Lý do" span={2}>{current.reason}</Descriptions.Item>
    </Descriptions>
    <section className="overtime-detail-section"><Title level={3}>Nhân sự và chứng từ đồng ý</Title>
      <Table pagination={false} size="small" rowKey={({ employee }) => employee.id} dataSource={current.members} columns={[
        { title: "Mã", dataIndex: ["employee", "code"], width: 120 },
        { title: "Họ tên", dataIndex: ["employee", "fullName"] },
        { title: "Tham chiếu chứng từ đồng ý", dataIndex: "consentReference" },
      ]} />
    </section>
    <section className="overtime-detail-section"><Title level={3}>Năng lực phê duyệt</Title>
      <Tag color={detail.data.review.approvable ? "success" : "error"}>{detail.data.review.approvable ? "Đủ điều kiện duyệt" : "Chưa đủ điều kiện duyệt"}</Tag>
      {detail.data.review.blocking.map((item) => <Alert key={item} className="overtime-feedback" type="error" showIcon message={item} />)}
      {detail.data.review.warnings.map((item) => <Alert key={item} className="overtime-feedback" type="warning" showIcon message={item} />)}
      <Table className="overtime-capacity" pagination={false} size="small" rowKey="employeeId" dataSource={detail.data.review.employees} columns={[
        { title: "Nhân sự", dataIndex: "code" },
        { title: "Trong ngày", render: (_, row) => `${formatHours(row.dailyMinutes)} / ${formatHours(row.dailyLimitMinutes)}` },
        { title: "Trong tháng", render: (_, row) => row.months.map((month) => `${month.month}: ${formatHours(month.minutes)} / ${formatHours(month.limitMinutes)}`).join("; ") || "—" },
        { title: "Trong năm", render: (_, row) => row.years.map((year) => `${year.year}: ${formatHours(year.minutes)} / ${formatHours(year.limitMinutes)}`).join("; ") || "—" },
      ]} />
    </section>
  </>;
  return <>
    <Modal className="overtime-detail-modal" title="Chi tiết đề nghị tăng ca" open onCancel={onClose} footer={null} width={980} destroyOnHidden>
      <Space className="overtime-actions" wrap>
        {canEdit && <Button icon={<EditOutlined />} onClick={() => onEdit(detail.data.request)}>Sửa đề nghị</Button>}
        {isCreator && ["DRAFT", "RETURNED"].includes(detail.data.request.status) && <Button type="primary" icon={<SendOutlined />} onClick={() => setPendingAction("SUBMIT")}>Gửi duyệt</Button>}
        {canReview && <Button type="primary" icon={<CheckOutlined />} disabled={!detail.data.review.approvable} onClick={() => setPendingAction("APPROVE")}>Duyệt đề nghị</Button>}
        {canReview && <Button onClick={() => setPendingAction("RETURN")}>Trả lại</Button>}
        {canReview && <Button danger onClick={() => setPendingAction("REJECT")}>Từ chối</Button>}
        {canCancel && <Button danger icon={<CloseOutlined />} onClick={() => setPendingAction("CANCEL")}>Hủy đề nghị</Button>}
      </Space>
      {actionMutation.isError && <Alert className="overtime-feedback" type="error" showIcon message="Không thể cập nhật trạng thái" description={errorMessage(actionMutation.error)} />}
      <Tabs activeKey={detailTab} onChange={setDetailTab} items={[{ key: "summary", label: "Thông tin đề nghị", children: summary }, { key: "history", label: "Lịch sử", children: <Table rowKey="id" size="small" scroll={{ x: 820 }} pagination={{ pageSize: 8, showSizeChanger: false }} dataSource={detail.data.history} columns={requestColumns} locale={{ emptyText: <Empty description="Chưa có lịch sử thao tác" /> }} /> }]} />
    </Modal>
    <Modal title={pendingAction ? actionLabel[pendingAction] : ""} open={Boolean(pendingAction)} onCancel={() => { actionForm.resetFields(); setPendingAction(null); }} okText={pendingAction ? actionLabel[pendingAction] : "Xác nhận"} okButtonProps={{ danger: pendingAction === "REJECT" || pendingAction === "CANCEL", loading: actionMutation.isPending }} onOk={() => actionForm.validateFields().then((values) => pendingAction && actionMutation.mutate({ action: pendingAction, reason: values.reason }))} destroyOnHidden>
      <Form form={actionForm} layout="vertical" requiredMark="optional">
        <Paragraph>{pendingAction === "SUBMIT" ? "Gửi đề nghị để cấp có thẩm quyền phê duyệt?" : `${pendingAction ? actionLabel[pendingAction] : "Thao tác"} sẽ thay đổi trạng thái đề nghị. Bạn có chắc chắn?`}</Paragraph>
        <Form.Item name="reason" label="Lý do" rules={reasonRequired ? required : []}><Input.TextArea rows={3} maxLength={2000} placeholder={reasonRequired ? "Nhập lý do bắt buộc" : "Có thể ghi chú thêm"} /></Form.Item>
      </Form>
    </Modal>
  </>;
}

export function OvertimeWorkspace({ user }: { user: AuthUser }) {
  const [filters, setFilters] = useState<OvertimeFilters>(defaultFilters);
  const [editor, setEditor] = useState<OvertimeSnapshot | null | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const context = useQuery({ queryKey: ["overtime", "context"], queryFn: overtimeApi.context });
  const requests = useQuery({ queryKey: ["overtime", "requests", filters], queryFn: () => overtimeApi.requests(filters) });
  const columns: ColumnsType<OvertimeSnapshot> = [
    { title: "Ngày", dataIndex: "workDate", width: 110 },
    { title: "Đơn vị", dataIndex: "teamOrgUnitCode", width: 105 },
    { title: "Đề nghị", dataIndex: "title", ellipsis: true },
    { title: "Thời gian (VN)", render: (_, row) => <>{vietnamDateTime(row.startAt)}<br />{vietnamDateTime(row.endAt)}</>, width: 180 },
    { title: "Thời lượng", dataIndex: "requestedMinutes", width: 110, align: "right", render: formatHours },
    { title: "Nhân sự", dataIndex: "members", width: 90, align: "right", render: (members: OvertimeSnapshot["members"]) => members.length },
    { title: "Trạng thái", dataIndex: "status", width: 120, render: (status: OvertimeStatus) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag> },
    { title: "Người lập", dataIndex: ["createdBy", "displayName"], width: 140 },
    { title: "Thao tác", width: 100, fixed: "right", render: (_, row) => <Button type="link" onClick={() => setDetailId(row.id)}>Chi tiết</Button> },
  ];
  return <section className="workspace overtime-workspace" aria-labelledby="overtime-title">
    <div className="page-heading"><div><Title id="overtime-title" level={2}>Tăng ca (OT)</Title><Paragraph type="secondary">Lập, phê duyệt và truy vết đề nghị làm thêm theo đơn vị được phân quyền.</Paragraph></div>
      {context.data?.canPlan && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor(null)}>Lập đề nghị OT</Button>}
    </div>
    {context.isError && <Alert type="error" showIcon message="Không tải được phạm vi tăng ca" description={errorMessage(context.error)} />}
    {!context.isLoading && context.data && !context.data.canPlan && !context.data.canApprove && <Alert type="info" showIcon message="Bạn có quyền xem đề nghị tăng ca trong phạm vi được cấp." />}
    <div className="workspace-filters" aria-label="Bộ lọc đề nghị tăng ca">
      <label>Từ ngày<Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
      <label>Đến ngày<Input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
      <label>Đơn vị<Select allowClear value={filters.teamOrgUnitId} placeholder="Tất cả đơn vị" options={context.data?.units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} onChange={(teamOrgUnitId) => setFilters((current) => ({ ...current, teamOrgUnitId }))} /></label>
      <label>Trạng thái<Select allowClear value={filters.status} placeholder="Tất cả trạng thái" options={(Object.keys(statusLabels) as OvertimeStatus[]).map((status) => ({ value: status, label: statusLabels[status] }))} onChange={(status) => setFilters((current) => ({ ...current, status }))} /></label>
    </div>
    {requests.isError ? <Alert type="error" showIcon message="Không tải được danh sách đề nghị" description={errorMessage(requests.error)} /> : requests.isLoading ? <div className="workspace-loading"><Spin /> Đang tải đề nghị tăng ca…</div> : <Table className="workspace-table" rowKey="id" dataSource={requests.data?.items ?? []} columns={columns} scroll={{ x: 1060 }} pagination={{ pageSize: 12, showSizeChanger: false }} locale={{ emptyText: <Empty description="Không có đề nghị tăng ca trong khoảng ngày đã chọn" /> }} />}
    {editor !== undefined && <RequestEditor key={editor?.id ?? "new"} request={editor} onClose={() => setEditor(undefined)} />}
    {detailId && <RequestDetail id={detailId} user={user} canApprove={Boolean(context.data?.canApprove)} onClose={() => setDetailId(null)} onEdit={(request) => { setDetailId(null); setEditor(request); }} />}
  </section>;
}
