import {
  FileAddOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type HTMLAttributes } from "react";
import { errorMessage } from "../api/client";
import { employeeApi, organizationApi } from "../api/hrtp";
import type { AuthUser, Employee, OrgUnit } from "../api/hrtp";
import {
  periodApi,
  personnelApi,
  settingsApi,
  type AttendancePeriod,
  type ContractType,
  type CutoffPolicy,
  type EmploymentContract,
  type LegalParameter,
  type PeriodPreview as PeriodPreviewData,
} from "../api/hr-next";

const { Title, Paragraph, Text } = Typography;
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateIsReal(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const requiredDateRule = (label: string) => ({
  required: true,
  message: `Chọn ${label}.`,
  validator: (_: unknown, value?: string) =>
    !value || dateIsReal(value)
      ? Promise.resolve()
      : Promise.reject(new Error("Ngày phải theo định dạng YYYY-MM-DD hợp lệ.")),
});

function ApiProblem({ error, title }: { error: unknown; title: string }) {
  return <Alert type="error" showIcon message={title} description={errorMessage(error)} />;
}

function DateField({ name, label, required = true }: { name: string; label: string; required?: boolean }) {
  return (
    <Form.Item name={name} label={label} rules={required ? [requiredDateRule(label.toLowerCase())] : [{ validator: (_: unknown, value?: string) => !value || dateIsReal(value) ? Promise.resolve() : Promise.reject(new Error("Ngày phải theo định dạng YYYY-MM-DD hợp lệ.")) }]}>
      <Input type="date" />
    </Form.Item>
  );
}

// Legal numeric values are stored as decimal strings so precision survives JSON transport.
function parseParameterValue(raw: string): unknown {
  const text = raw.trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : JSON.parse(text);
}

function personStatus(status: Employee["status"]) {
  return <Tag color={status === "ACTIVE" ? "success" : "default"}>{status === "ACTIVE" ? "Đang làm việc" : "Đã nghỉ việc"}</Tag>;
}

export function EmployeeProfileDrawer({ employee, user, onClose }: { employee: Employee | null; user: AuthUser; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["employee", employee?.id],
    queryFn: () => employeeApi.get(employee!.id),
    enabled: Boolean(employee),
  });
  const [activeTab, setActiveTab] = useState("profile");
  const person = detail.data?.employee;
  const canReadContracts = user.permissions.includes("contract.read");
  const canHistory = user.permissions.includes("employee.history");
  const items = person
    ? [
        {
          key: "profile",
          label: "Hồ sơ",
          children: <ProfileTab person={person} />,
        },
        ...(canReadContracts
          ? [{ key: "contracts", label: "Hợp đồng", children: <ContractsTab employeeId={person.id} canManage={user.permissions.includes("contract.manage")} /> }]
          : []),
        ...(canHistory
          ? [{ key: "history", label: "Lịch sử đơn vị", children: <HistoryTab employeeId={person.id} canTransfer={user.permissions.includes("employee.transfer")} /> }]
          : []),
      ]
    : [];
  return (
    <Modal
      title="Hồ sơ nhân sự"
      open={Boolean(employee)}
      onCancel={onClose}
      footer={null}
      width={920}
      destroyOnHidden
      afterClose={() => setActiveTab("profile")}
      className="employee-profile-modal"
    >
      {detail.isLoading ? <div className="content-loading"><Spin /></div> : detail.isError ? <ApiProblem title="Không tải được hồ sơ" error={detail.error} /> : person ? (
        <div className="drawer-detail">
          <div className="detail-identity">
            <div className="person-mark" aria-hidden="true">{person.fullName.slice(0, 1)}</div>
            <div><Title level={2}>{person.fullName}</Title><Text type="secondary">{person.code}</Text></div>
            {personStatus(person.status)}
          </div>
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} />
        </div>
      ) : <Empty description="Không tìm thấy hồ sơ trong phạm vi hiện tại" />}
    </Modal>
  );
}

function ProfileTab({ person }: { person: Employee }) {
  return <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" items={[
    { key: "gender", label: "Giới tính", children: person.gender === "MALE" ? "Nam" : person.gender === "FEMALE" ? "Nữ" : "Khác" },
    { key: "dob", label: "Ngày sinh", children: person.dob },
    { key: "hire", label: "Ngày vào làm", children: person.hireDate },
    { key: "nationality", label: "Quốc tịch", children: person.nationality },
    { key: "unit", label: "Đơn vị", children: `${person.orgUnit.name} (${person.orgUnit.code})` },
    { key: "title", label: "Chức danh", children: person.jobTitle?.name ?? "—" },
    { key: "email", label: "Email", children: person.email ?? "—" },
    { key: "phone", label: "Điện thoại", children: person.phone ?? "—" },
  ]} />;
}

function ContractsTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [annexContract, setAnnexContract] = useState<EmploymentContract | null>(null);
  const contracts = useQuery({ queryKey: ["contracts", employeeId], queryFn: () => personnelApi.contracts(employeeId) });
  const activate = useMutation({
    mutationFn: (contractId: string) => personnelApi.activateContract(employeeId, contractId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["contracts", employeeId] }),
  });
  if (contracts.isLoading) return <div className="content-loading"><Spin /></div>;
  if (contracts.isError) return <ApiProblem title="Không tải được hợp đồng" error={contracts.error} />;
  const data = contracts.data;
  return <div className="tab-stack">
    {data?.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
    {canManage && <div className="tab-actions"><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo dự thảo</Button></div>}
    <Table<EmploymentContract> rowKey="id" size="small" scroll={{ x: 840 }} pagination={false} dataSource={data?.items ?? []} locale={{ emptyText: <Empty description="Chưa có hợp đồng" /> }}
      expandable={{
        rowExpandable: (item) => item.annexes.length > 0,
        expandedRowRender: (item) => <div className="tab-stack">{item.annexes.map((annex) => <Descriptions key={annex.id} title={`Phụ lục ${annex.number}`} size="small" bordered column={{ xs: 1, sm: 2 }} items={[
          { key: "from", label: "Ngày hiệu lực", children: annex.effectiveFrom },
          { key: "signed", label: "Ngày ký", children: annex.signedDate },
          { key: "content", label: "Nội dung", span: 2, children: <span style={{ whiteSpace: "pre-wrap" }}>{annex.content}</span> },
        ]} />)}</div>,
      }}
      columns={[
      { title: "Số hợp đồng", dataIndex: "number", width: 150 },
      { title: "Loại", dataIndex: "type", width: 150, render: contractTypeLabel },
      { title: "Hiệu lực", key: "dates", render: (_, item) => <span>{item.startDate}<small className="table-subtext">{item.endDate ? `đến ${item.endDate}` : "Không thời hạn"}</small></span> },
      { title: "Lương", dataIndex: "salary", align: "right", render: (value, item) => <span className="numeric">{value}<small className="table-subtext">{item.salaryBasis === "MONTHLY" ? "Theo tháng" : "Theo giờ"}</small></span> },
      { title: "Trạng thái", dataIndex: "status", width: 110, render: (status) => <Tag color={status === "ACTIVE" ? "success" : "gold"}>{status === "ACTIVE" ? "Đang hiệu lực" : "Dự thảo"}</Tag> },
      ...(canManage ? [{ title: "Thao tác", key: "actions", width: 210, render: (_: unknown, item: EmploymentContract) => <Space size="small" wrap>{item.status === "DRAFT" && <Button size="small" loading={activate.isPending && activate.variables === item.id} onClick={() => activate.mutate(item.id)}>Kích hoạt</Button>}<Button size="small" icon={<FileAddOutlined />} onClick={() => setAnnexContract(item)}>Phụ lục</Button></Space> }] : []),
    ]} />
    {activate.isError && <ApiProblem title="Không thể kích hoạt hợp đồng" error={activate.error} />}
    <CreateContract open={createOpen} employeeId={employeeId} onClose={() => setCreateOpen(false)} />
    <AddAnnex open={Boolean(annexContract)} employeeId={employeeId} contract={annexContract} onClose={() => setAnnexContract(null)} />
  </div>;
}

function contractTypeLabel(value: ContractType) {
  return ({ INDEFINITE: "Không xác định hạn", FIXED_TERM: "Xác định hạn", PROBATION: "Thử việc", UNDER_ONE_MONTH: "Dưới 01 tháng", PIECEWORK: "Khoán việc", COLLABORATOR: "Cộng tác viên" } as Record<ContractType, string>)[value];
}

function CreateContract({ open, employeeId, onClose }: { open: boolean; employeeId: string; onClose: () => void }) {
  const [form] = Form.useForm(); const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ employeeId: id, payload }: { employeeId: string; payload: Parameters<typeof personnelApi.createContract>[1] }) => personnelApi.createContract(id, payload),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["contracts", employeeId] }); form.resetFields(); onClose(); },
    onError: (error) => form.setFields([{ name: "number", errors: [errorMessage(error)] }]),
  });
  return <Modal title="Tạo dự thảo hợp đồng" open={open} onCancel={onClose} footer={null} destroyOnHidden afterClose={() => form.resetFields()}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={(values) => {
      const payload: Parameters<typeof personnelApi.createContract>[1] = {
        number: values.number.trim(), type: values.type, startDate: values.startDate, signedDate: values.signedDate,
        salary: values.salary.trim(), salaryBasis: values.salaryBasis,
        ...(values.endDate ? { endDate: values.endDate } : {}),
        ...(values.officialSalary ? { officialSalary: values.officialSalary.trim() } : {}),
        ...(values.probationClass ? { probationClass: values.probationClass } : {}),
      };
      mutation.mutate({ employeeId, payload });
    }}>
      <div className="form-grid">
        <Form.Item name="number" label="Số hợp đồng" rules={[{ required: true, whitespace: true, message: "Nhập số hợp đồng." }]}><Input /></Form.Item>
        <Form.Item name="type" label="Loại hợp đồng" rules={[{ required: true, message: "Chọn loại hợp đồng." }]}><Select options={(["INDEFINITE", "FIXED_TERM", "PROBATION", "UNDER_ONE_MONTH", "PIECEWORK", "COLLABORATOR"] as ContractType[]).map((value) => ({ value, label: contractTypeLabel(value) }))} /></Form.Item>
        <DateField name="startDate" label="Ngày bắt đầu" />
        <DateField name="endDate" label="Ngày kết thúc" required={false} />
        <DateField name="signedDate" label="Ngày ký" />
        <Form.Item name="salaryBasis" label="Cơ sở lương" rules={[{ required: true, message: "Chọn cơ sở lương." }]}><Select options={[{ value: "MONTHLY", label: "Theo tháng" }, { value: "HOURLY", label: "Theo giờ" }]} /></Form.Item>
        <Form.Item name="salary" label="Mức lương" rules={[{ required: true, pattern: /^\d+(\.\d+)?$/, message: "Nhập số tiền dương, không dùng dấu phân cách." }]}><Input inputMode="decimal" /></Form.Item>
        <Form.Item name="officialSalary" label="Lương chính thức" rules={[{ pattern: /^\d+(\.\d+)?$/, message: "Nhập số tiền dương, không dùng dấu phân cách." }]}><Input inputMode="decimal" /></Form.Item>
        <Form.Item className="form-span-2" name="probationClass" label="Nhóm thử việc"><Select allowClear options={[{ value: "TECHNICAL", label: "Kỹ thuật" }, { value: "WORKER", label: "Công nhân" }]} /></Form.Item>
      </div>
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu dự thảo</Button></Space>
    </Form>
  </Modal>;
}

function AddAnnex({ open, employeeId, contract, onClose }: { open: boolean; employeeId: string; contract: EmploymentContract | null; onClose: () => void }) {
  const [form] = Form.useForm(); const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: { number: string; effectiveFrom: string; signedDate: string; content: string }) => personnelApi.addAnnex(employeeId, contract!.id, payload),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["contracts", employeeId] }); form.resetFields(); onClose(); },
    onError: (error) => form.setFields([{ name: "number", errors: [errorMessage(error)] }]),
  });
  return <Modal title={contract ? `Thêm phụ lục · ${contract.number}` : "Thêm phụ lục"} open={open} onCancel={onClose} footer={null} destroyOnHidden afterClose={() => form.resetFields()}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={(values) => mutation.mutate({ ...values, number: values.number.trim(), content: values.content.trim() })}>
      <Form.Item name="number" label="Số phụ lục" rules={[{ required: true, whitespace: true, message: "Nhập số phụ lục." }]}><Input /></Form.Item>
      <div className="form-grid"><DateField name="effectiveFrom" label="Ngày hiệu lực" /><DateField name="signedDate" label="Ngày ký" /></div>
      <Form.Item name="content" label="Nội dung" rules={[{ required: true, whitespace: true, message: "Nhập nội dung phụ lục." }]}><Input.TextArea rows={4} /></Form.Item>
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Thêm phụ lục</Button></Space>
    </Form>
  </Modal>;
}

function HistoryTab({ employeeId, canTransfer }: { employeeId: string; canTransfer: boolean }) {
  const [form] = Form.useForm<{ asOf: string }>(); const [asOf, setAsOf] = useState(TODAY); const [transferOpen, setTransferOpen] = useState(false);
  const history = useQuery({ queryKey: ["employee-assignments", employeeId, asOf], queryFn: () => personnelApi.assignments(employeeId, asOf), enabled: dateIsReal(asOf) });
  return <div className="tab-stack">
    <div className="history-toolbar"><Form form={form} layout="inline" initialValues={{ asOf: TODAY }} onFinish={(values) => setAsOf(values.asOf)}><DateField name="asOf" label="Hiệu lực tại ngày" /><Button htmlType="submit">Xem lịch sử</Button></Form>{canTransfer && <Button type="primary" icon={<SwapOutlined />} onClick={() => setTransferOpen(true)}>Điều chuyển</Button>}</div>
    {history.isLoading ? <div className="content-loading"><Spin /></div> : history.isError ? <ApiProblem title="Không tải được lịch sử đơn vị" error={history.error} /> : <>
      <Table rowKey="id" size="small" scroll={{ x: 680 }} pagination={false} dataSource={history.data?.items ?? []} locale={{ emptyText: <Empty description="Không có phân công hiệu lực tại ngày đã chọn" /> }} columns={[
        { title: "Đơn vị", key: "unit", render: (_, item) => <span>{item.orgUnitName}<small className="table-subtext">{item.orgUnitCode}</small></span> },
        { title: "Thời gian", key: "duration", render: (_, item) => `${item.effectiveFrom} — ${item.effectiveTo ?? "Hiện tại"}` },
        { title: "Vai trò", key: "primary", render: (_, item) => item.isPrimary ? <Tag color="blue">Chính</Tag> : <Tag>Kiêm nhiệm</Tag> },
        { title: "Tỷ lệ", dataIndex: "allocationRatio", align: "right", render: (value) => `${value}%` },
      ]} />
      <div className="subsection-heading"><HistoryOutlined /> Lịch sử điều chuyển</div>
      <Table rowKey="id" size="small" scroll={{ x: 760 }} pagination={false} dataSource={history.data?.transfers ?? []} locale={{ emptyText: <Empty description="Chưa có quyết định điều chuyển" /> }} columns={[
        { title: "Ngày hiệu lực", dataIndex: "effectiveFrom", width: 135 }, { title: "Số quyết định", dataIndex: "decisionNumber", width: 150 }, { title: "Ngày quyết định", dataIndex: "decisionDate", width: 140 }, { title: "Lý do", dataIndex: "reason" },
      ]} />
    </>}
    <TransferEmployee open={transferOpen} employeeId={employeeId} onClose={() => setTransferOpen(false)} />
  </div>;
}

function TransferEmployee({ open, employeeId, onClose }: { open: boolean; employeeId: string; onClose: () => void }) {
  const [form] = Form.useForm(); const client = useQueryClient();
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context, enabled: open });
  const mutation = useMutation({
    mutationFn: ({ employeeId: id, payload }: { employeeId: string; payload: Parameters<typeof personnelApi.transfer>[1] }) => personnelApi.transfer(id, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["employee-assignments", employeeId] });
      void client.invalidateQueries({ queryKey: ["employee", employeeId] });
      void client.invalidateQueries({ queryKey: ["employees"] });
      form.resetFields(); onClose();
    },
    onError: (error) => form.setFields([{ name: "toOrgUnitId", errors: [errorMessage(error)] }]),
  });
  return <Modal title="Điều chuyển nhân sự" open={open} onCancel={onClose} footer={null} destroyOnHidden afterClose={() => form.resetFields()}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={(values) => mutation.mutate({ employeeId, payload: { ...values, decisionNumber: values.decisionNumber.trim(), reason: values.reason.trim() } })}>
      <Form.Item name="toOrgUnitId" label="Đơn vị nhận" rules={[{ required: true, message: "Chọn đơn vị nhận." }]}><Select loading={context.isLoading} options={context.data?.units.map((unit) => ({ value: unit.id, label: unit.pathLabel }))} /></Form.Item>
      <div className="form-grid"><DateField name="effectiveFrom" label="Ngày hiệu lực" /><DateField name="decisionDate" label="Ngày quyết định" /></div>
      <Form.Item name="decisionNumber" label="Số quyết định" rules={[{ required: true, whitespace: true, message: "Nhập số quyết định." }]}><Input /></Form.Item>
      <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: "Nhập lý do điều chuyển." }]}><Input.TextArea rows={3} /></Form.Item>
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu điều chuyển</Button></Space>
    </Form>
  </Modal>;
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState("parameters");
  return <div className="content-stack"><div className="page-heading"><div><p className="eyebrow">QUẢN TRỊ / HIỆU LỰC PHÁP LÝ</p><Title level={1}>Tham số và chính sách</Title><Paragraph type="secondary">Mỗi thay đổi tạo một phiên bản hiệu lực mới; dữ liệu đã chốt không bị ghi đè.</Paragraph></div></div><section className="panel settings-panel"><Tabs activeKey={activeTab} onChange={setActiveTab} items={[{ key: "parameters", label: "Tham số pháp lý", children: <ParametersTab /> }, { key: "policies", label: "Chính sách chốt công", children: <PoliciesTab /> }]} /></section></div>;
}

function ParametersTab() {
  const client = useQueryClient(); const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(TODAY);
  const parameters = useQuery({ queryKey: ["legal-parameters", asOf], queryFn: () => settingsApi.parameters({ asOf }) });
  const create = useMutation({ mutationFn: settingsApi.createParameter, onSuccess: ({ parameter }) => { setAsOf(parameter.effectiveFrom); void client.invalidateQueries({ queryKey: ["legal-parameters"] }); setOpen(false); } });
  return <div className="tab-stack"><div className="history-toolbar"><Space><label htmlFor="parameter-asof">Hiệu lực tại</label><Input id="parameter-asof" type="date" value={asOf} onChange={(event) => { if (dateIsReal(event.target.value)) setAsOf(event.target.value); }} /></Space><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Thêm phiên bản</Button></div>{parameters.isError ? <ApiProblem title="Không tải được tham số pháp lý" error={parameters.error} /> : <Table<LegalParameter> rowKey="id" loading={parameters.isLoading} size="small" scroll={{ x: 1050 }} pagination={false} dataSource={parameters.data?.items ?? []} locale={{ emptyText: <Empty description="Chưa có tham số pháp lý" /> }} columns={[
    { title: "Mã", dataIndex: "paramCode", width: 150 }, { title: "Phạm vi", dataIndex: "scopeKey", width: 150 }, { title: "Đối tượng", dataIndex: "subjectType", width: 150 }, { title: "Căn cứ", dataIndex: "applicationBasis", width: 130 }, { title: "Giá trị", dataIndex: "value", render: (value) => <Text code>{JSON.stringify(value)}</Text> }, { title: "Hiệu lực", key: "validity", width: 220, render: (_, item) => `${item.effectiveFrom} — ${item.effectiveTo ?? "mở"}` },
  ]} />}{create.isError && <ApiProblem title="Không tạo được phiên bản tham số" error={create.error} />}<ParameterForm open={open} loading={create.isPending} onClose={() => setOpen(false)} onSubmit={(payload) => create.mutate(payload)} /></div>;
}

function ParameterForm({ open, loading, onClose, onSubmit }: { open: boolean; loading: boolean; onClose: () => void; onSubmit: (payload: Omit<LegalParameter, "id">) => void }) {
  const [form] = Form.useForm();
  return <Modal title="Thêm phiên bản tham số pháp lý" open={open} onCancel={onClose} footer={null} destroyOnHidden afterClose={() => form.resetFields()} width={700}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={loading} onFinish={(values) => onSubmit({ ...values, paramCode: values.paramCode.trim(), scopeKey: values.scopeKey.trim(), subjectType: values.subjectType.trim(), unit: values.unit.trim(), legalBasis: values.legalBasis.trim(), value: parseParameterValue(values.value), ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : {}) })}>
      <div className="form-grid"><Form.Item name="paramCode" label="Mã tham số" rules={[{ required: true, whitespace: true, message: "Nhập mã tham số." }]}><Input /></Form.Item><Form.Item name="scopeKey" label="Phạm vi" rules={[{ required: true, pattern: /^(GLOBAL|REGION:(I|II|III|IV)|SITE:[0-9a-f-]+)$/i, message: "Dùng GLOBAL, REGION:I–IV hoặc SITE:<UUID>." }]}><Input placeholder="GLOBAL" /></Form.Item><Form.Item name="subjectType" label="Đối tượng áp dụng" rules={[{ required: true, whitespace: true, message: "Nhập đối tượng áp dụng." }]}><Input /></Form.Item><Form.Item name="applicationBasis" label="Căn cứ áp dụng" rules={[{ required: true, message: "Chọn căn cứ." }]}><Select options={[{ value: "WORK_DATE", label: "Ngày công" }, { value: "TAX_YEAR", label: "Năm thuế" }, { value: "PAYMENT_DATE", label: "Ngày thanh toán" }]} /></Form.Item><Form.Item name="unit" label="Đơn vị tính" rules={[{ required: true, whitespace: true, message: "Nhập đơn vị tính." }]}><Input /></Form.Item><DateField name="effectiveFrom" label="Hiệu lực từ" /><DateField name="effectiveTo" label="Hiệu lực đến" required={false} /><DateField name="documentEffectiveDate" label="Ngày hiệu lực văn bản" /></div>
      <Form.Item name="value" label="Giá trị JSON" rules={[{ required: true, whitespace: true, message: "Nhập giá trị JSON." }, { validator: (_: unknown, value?: string) => { try { parseParameterValue(value ?? ""); return Promise.resolve(); } catch { return Promise.reject(new Error("Giá trị phải là JSON hợp lệ.")); } } }]}><Input.TextArea rows={4} placeholder={'Ví dụ: 5310000 hoặc {"rate": "0.1"}'} /></Form.Item><Text type="secondary">Giá trị số được lưu dưới dạng chuỗi thập phân để giữ nguyên độ chính xác.</Text>
      <Form.Item name="legalBasis" label="Căn cứ pháp lý" rules={[{ required: true, whitespace: true, message: "Nhập căn cứ pháp lý." }]}><Input.TextArea rows={2} /></Form.Item><Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={loading}>Tạo phiên bản</Button></Space>
    </Form>
  </Modal>;
}

function PoliciesTab() {
  const client = useQueryClient(); const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(TODAY);
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  const policies = useQuery({ queryKey: ["cutoff-policies", asOf], queryFn: () => settingsApi.policies({ asOf }) });
  const create = useMutation({ mutationFn: settingsApi.createPolicy, onSuccess: ({ policy }) => { setAsOf(policy.effectiveFrom); void client.invalidateQueries({ queryKey: ["cutoff-policies"] }); setOpen(false); } });
  return <div className="tab-stack"><div className="history-toolbar"><Space><label htmlFor="policy-asof">Hiệu lực tại</label><Input id="policy-asof" type="date" value={asOf} onChange={(event) => { if (dateIsReal(event.target.value)) setAsOf(event.target.value); }} /></Space><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Thêm phiên bản</Button></div>{policies.isError ? <ApiProblem title="Không tải được chính sách chốt công" error={policies.error} /> : <Table<CutoffPolicy> rowKey="id" loading={policies.isLoading} size="small" scroll={{ x: 870 }} pagination={false} dataSource={policies.data?.items ?? []} locale={{ emptyText: <Empty description="Chưa có chính sách chốt công" /> }} columns={[
    { title: "Đơn vị", dataIndex: "orgUnitId", render: (id: string) => context.data?.units.find(unit => unit.id === id)?.pathLabel ?? id }, { title: "Chính sách", dataIndex: "policyKey", width: 140 }, { title: "Ngày chốt", dataIndex: "value", width: 120, align: "right" }, { title: "Trạng thái", dataIndex: "status", width: 170, render: (value) => <Tag color={value === "BUSINESS_CONFIRMED" ? "success" : "gold"}>{value === "BUSINESS_CONFIRMED" ? "Đã xác nhận" : "Mô phỏng"}</Tag> }, { title: "Hiệu lực", key: "validity", width: 220, render: (_, item) => `${item.effectiveFrom} — ${item.effectiveTo ?? "mở"}` },
  ]} />}{create.isError && <ApiProblem title="Không tạo được chính sách" error={create.error} />}<PolicyForm open={open} loading={create.isPending} onClose={() => setOpen(false)} onSubmit={(payload) => create.mutate(payload)} /></div>;
}

function PolicyForm({ open, loading, onClose, onSubmit }: { open: boolean; loading: boolean; onClose: () => void; onSubmit: (payload: Omit<CutoffPolicy, "id">) => void }) {
  const [form] = Form.useForm(); const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context, enabled: open });
  return <Modal title="Thêm phiên bản chính sách chốt công" open={open} onCancel={onClose} footer={null} destroyOnHidden afterClose={() => form.resetFields()}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={loading} initialValues={{ policyKey: "CUTOFF_DAY", status: "SIMULATION" }} onFinish={(values) => onSubmit({ ...values, policyKey: "CUTOFF_DAY", decisionReference: values.decisionReference.trim(), ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : {}) })}>
      <Form.Item name="orgUnitId" label="Đơn vị" rules={[{ required: true, message: "Chọn đơn vị." }]}><Select loading={context.isLoading} options={siteUnits(context.data?.units).map((unit) => ({ value: unit.id, label: unit.pathLabel }))} /></Form.Item><div className="form-grid"><Form.Item name="value" label="Ngày chốt" rules={[{ required: true, message: "Nhập ngày chốt." }]}><InputNumber min={1} max={31} precision={0} className="full-width" /></Form.Item><Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}><Select options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }]} /></Form.Item><DateField name="effectiveFrom" label="Hiệu lực từ" /><DateField name="effectiveTo" label="Hiệu lực đến" required={false} /></div><Form.Item name="decisionReference" label="Tham chiếu quyết định" rules={[{ required: true, whitespace: true, message: "Nhập tham chiếu quyết định." }]}><Input /></Form.Item><Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={loading}>Tạo phiên bản</Button></Space></Form>
  </Modal>;
}

export function PeriodsPage({ user }: { user: AuthUser }) {
  const canManage = user.permissions.includes("period.manage"); const client = useQueryClient(); const [createOpen, setCreateOpen] = useState(false); const [previewArgs, setPreviewArgs] = useState<{ scopeOrgUnitId: string; month: string }>();
  const periods = useQuery({ queryKey: ["attendance-periods"], queryFn: periodApi.list });
  const preview = useQuery({ queryKey: ["period-preview", previewArgs], queryFn: () => periodApi.preview(previewArgs!.scopeOrgUnitId, previewArgs!.month), enabled: Boolean(previewArgs) });
  const openPeriod = useMutation({ mutationFn: ({ id, revision }: AttendancePeriod) => periodApi.open(id, revision), onSuccess: () => void client.invalidateQueries({ queryKey: ["attendance-periods"] }) });
  return <div className="content-stack"><div className="page-heading"><div><p className="eyebrow">CHẤM CÔNG / KỲ HIỆU LỰC</p><Title level={1}>Kỳ công</Title><Paragraph type="secondary">Danh sách kỳ công trong phạm vi được cấp. Kỳ mới dùng chính sách chốt công hiệu lực tại ngày đầu tháng.</Paragraph></div>{canManage && <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo kỳ công</Button>}</div>{canManage && <PeriodPreview onPreview={setPreviewArgs} data={preview.data} loading={preview.isFetching} error={preview.error} isError={preview.isError} />}
    <section className="panel table-panel">{periods.isError ? <ApiProblem title="Không tải được danh sách kỳ công" error={periods.error} /> : <Table<AttendancePeriod> components={{ body: { wrapper: PeriodTableBody } }} rowKey="id" loading={periods.isLoading} dataSource={periods.data?.items ?? []} pagination={false} scroll={{ x: 900 }} locale={{ emptyText: <Empty description="Chưa có kỳ công" /> }} columns={[
      { title: "Mã kỳ", dataIndex: "code", width: 150 },
      { title: "Phạm vi", dataIndex: "scopeOrgUnitName" },
      { title: "Khoảng công", key: "dates", render: (_, item) => item.dateFrom + " — " + item.dateTo },
      { title: "Ngày chốt", dataIndex: "cutoffDay", align: "right", width: 110 },
      { title: "Trạng thái", dataIndex: "status", width: 130, render: (status) => <Tag color={status === "OPEN" ? "success" : status === "PLANNED" ? "gold" : "default"}>{status}</Tag> },
      { title: "Phiên bản", dataIndex: "revision", align: "right", width: 100 },
      ...(canManage ? [{ title: "Thao tác", key: "action", width: 130, render: (_: unknown, item: AttendancePeriod) => item.status === "PLANNED" ? <Button size="small" loading={openPeriod.isPending && openPeriod.variables?.id === item.id} onClick={() => openPeriod.mutate(item)}>Mở kỳ</Button> : "—" }] : []),
    ]} />}</section>{openPeriod.isError && <ApiProblem title="Không thể mở kỳ công" error={openPeriod.error} />}<CreatePeriod open={createOpen} onClose={() => setCreateOpen(false)} /></div>;
}

function PeriodTableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Danh sách kỳ công" />;
}

function PeriodPreview({ onPreview, data, loading, error, isError }: { onPreview: (args: { scopeOrgUnitId: string; month: string }) => void; data: PeriodPreviewData | undefined; loading: boolean; error: unknown; isError: boolean }) {
  const [form] = Form.useForm(); const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  return <section className="panel preview-panel">
    <Form name="period-preview" form={form} layout="vertical" requiredMark="optional" className="preview-form" onFinish={onPreview}>
      <Form.Item name="scopeOrgUnitId" label="Đơn vị áp dụng" rules={[{ required: true, message: "Chọn đơn vị." }]}>
        <Select loading={context.isLoading} options={siteUnits(context.data?.units).map((unit) => ({ value: unit.id, label: unit.pathLabel }))} />
      </Form.Item>
      <Form.Item name="month" label="Tháng" rules={[{ required: true, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: "Chọn tháng hợp lệ." }]}>
        <Input type="month" />
      </Form.Item>
      <Button htmlType="submit" icon={<ReloadOutlined />} loading={loading}>Xem dự kiến</Button>
    </Form>
    {isError ? <ApiProblem title="Không xem được dự kiến kỳ công" error={error} /> : data ? <div aria-live="polite">
      <Text strong>{data.dateFrom} — {data.dateTo}</Text><br />
      <Text>Ngày chốt {data.cutoffDay} · {data.status === "SIMULATION" ? "Mô phỏng" : "Đã xác nhận"}</Text><br />
      <Text type="secondary">Tham chiếu: {data.decisionReference}</Text>
    </div> : <Text type="secondary">Chọn đơn vị và tháng để xem ngày công dự kiến.</Text>}
  </section>;
}

function CreatePeriod({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm(); const client = useQueryClient(); const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context, enabled: open });
  const create = useMutation({ mutationFn: periodApi.create, onSuccess: () => { void client.invalidateQueries({ queryKey: ["attendance-periods"] }); form.resetFields(); onClose(); }, onError: (error) => form.setFields([{ name: "code", errors: [errorMessage(error)] }]) });
  return <Modal title="Tạo kỳ công" open={open} onCancel={onClose} footer={null} destroyOnHidden afterClose={() => form.resetFields()}>
    <Form name="create-period" form={form} layout="vertical" requiredMark="optional" disabled={create.isPending} onFinish={(values) => create.mutate({
      code: values.code.trim(), scopeOrgUnitId: values.scopeOrgUnitId, month: values.month,
      ...(values.dateFrom ? { dateFrom: values.dateFrom } : {}), ...(values.dateTo ? { dateTo: values.dateTo } : {}),
    })}>
      <Form.Item name="code" label="Mã kỳ" rules={[{ required: true, whitespace: true, message: "Nhập mã kỳ." }]}><Input /></Form.Item>
      <Form.Item name="scopeOrgUnitId" label="Đơn vị áp dụng" rules={[{ required: true, message: "Chọn đơn vị." }]}>
        <Select loading={context.isLoading} options={siteUnits(context.data?.units).map((unit) => ({ value: unit.id, label: unit.pathLabel }))} />
      </Form.Item>
      <Form.Item name="month" label="Tháng" rules={[{ required: true, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: "Chọn tháng hợp lệ." }]}><Input type="month" /></Form.Item>
      <Paragraph type="secondary">Để trống cả hai ngày để dùng khoảng công dự kiến theo chính sách.</Paragraph>
      <div className="form-grid"><DateField name="dateFrom" label="Ngày bắt đầu" required={false} /><DateField name="dateTo" label="Ngày kết thúc" required={false} /></div>
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Tạo kỳ</Button></Space>
    </Form>
  </Modal>;
}

function siteUnits(units: OrgUnit[] | undefined) { return (units ?? []).filter((unit) => unit.type !== "COMPANY" && Boolean(unit.siteId)); }
