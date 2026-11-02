import { HistoryOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Descriptions, Drawer, Empty, Form, Grid, Input, InputNumber, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { ApiError, errorMessage } from "../api/client";
import type { AuthUser } from "../api/hrtp";
import { salaryComponentsApi } from "../api/salary-components";
import type { CreateSalaryComponentInput, SalaryComponent, SalaryComponentContext, SalaryComponentFilter, SalaryComponentInput, SalaryComponentType, SalaryComponentVersion, SalaryTaxClassification } from "../api/salary-components";
import { TechnicalDetails } from "./TechnicalDetails";

const { Title, Paragraph, Text } = Typography;
const required = [{ required: true, whitespace: true, message: "Nhập thông tin bắt buộc." }];
const componentTypes: Record<SalaryComponentType, string> = { EARNING: "Thu nhập", DEDUCTION: "Khấu trừ", EMPLOYER_COST: "Chi phí doanh nghiệp" };
const taxClasses: Record<SalaryTaxClassification, string> = { TAXABLE: "Chịu thuế", NON_TAXABLE: "Không tính thuế", CONDITIONAL: "Theo điều kiện / hạn mức" };
const provenanceOptions = [{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }];
const timeFormatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short", hour12: false });
function day(value: string) { return value.split("-").reverse().join("/"); }
function windowText(version: SalaryComponentVersion) { return day(version.effectiveFrom) + " – " + (version.effectiveTo ? day(version.effectiveTo) : "Không thời hạn"); }
function provenance(version: SalaryComponentVersion) { return <Tag color={version.status === "SIMULATION" ? "warning" : "success"}>{version.status === "SIMULATION" ? "Mô phỏng" : "Đã xác nhận nghiệp vụ"}</Tag>; }
function flag(value: boolean) { return value ? "Có" : "Không"; }
function preserveRequiredCombobox(select: { nativeElement: HTMLElement } | null) {
  // Match existing forms: rc-select keeps aria-required on its combobox input.
  select?.nativeElement.removeAttribute("aria-required");
}
function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} tabIndex={0} aria-label="Bảng cấu phần lương; dùng phím mũi tên để cuộn" />; }
const tableComponents = { body: { wrapper: TableBody } };

function ClassificationDetails({ version }: { version: SalaryComponentVersion }) {
  return <Descriptions column={1} size="small" bordered items={[
    { key: "type", label: "Loại khoản", children: componentTypes[version.componentType] },
    { key: "active", label: "Cho phép sử dụng", children: flag(version.active) },
    { key: "si", label: "Tính đóng bảo hiểm", children: flag(version.isInsurable) },
    { key: "tax", label: "Phân loại thuế", children: taxClasses[version.taxClassification] },
    { key: "ot", label: "Tính vào căn cứ OT", children: flag(version.isOtBase) },
    { key: "prorate", label: "Phân bổ theo công", children: flag(version.isProrated) },
    { key: "order", label: "Thứ tự hiển thị", children: version.displayOrder },
    { key: "basis", label: "Căn cứ phân loại", children: version.classificationBasis },
    { key: "reference", label: "Quyết định / chứng từ", children: version.decisionReference },
    { key: "reason", label: "Lý do tạo phiên bản", children: version.reason },
    { key: "author", label: "Người tạo", children: version.createdBy.displayName },
    { key: "at", label: "Thời điểm (giờ Việt Nam)", children: timeFormatter.format(new Date(version.createdAt)) },
  ]} />;
}

function ComponentHistory({ id, asOf, onClose }: { id: string; asOf?: string; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  const query = useQuery({ queryKey: ["salary-component", id, asOf], queryFn: () => salaryComponentsApi.detail(id, asOf) });
  const item = query.data?.item;
  return <Drawer open title={query.isError ? "Lịch sử cấu phần lương" : item ? `Lịch sử · ${item.code}` : "Đang tải lịch sử"} width={screens.md ? 760 : "100%"} onClose={onClose} className="salary-component-history">
    {query.isError ? <Alert type="error" showIcon message="Không thể đọc lịch sử" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Tải lại</Button>} /> : query.isPending ? <Skeleton active /> : item && <>
      <Paragraph><strong>{item.orgUnitName}</strong> · Phiên bản danh mục {item.revision}. Ngày đang xem: {asOf ? day(asOf) : "hiện tại"}.</Paragraph>
      <Alert type="info" showIcon message="Nội dung phiên bản chỉ đọc" description="Phiên bản kế tiếp chỉ có hiệu lực trong tương lai. Ngày kết thúc của bản liền trước được đóng tại ngày trước đó; không sửa các phân loại đã lưu." />
      {item.versions.map(version => <section className="salary-component-version" key={version.id}>
        <Title level={2}>{version.name}</Title>
        <Space wrap>{provenance(version)}<Text>{windowText(version)}</Text>{item.activeVersion?.id === version.id && <Tag color="processing">Hiệu lực ngày đang xem</Tag>}</Space>
        <ClassificationDetails version={version} />
        <TechnicalDetails title="Định danh phiên bản"><Descriptions column={1} items={[{ key: "id", label: "ID phiên bản", children: version.id }]} /></TechnicalDetails>
      </section>)}
    </>}
  </Drawer>;
}

interface EditorProps { item?: SalaryComponent; context: SalaryComponentContext; onClose: () => void; onSaved: (code: string) => void }
function ComponentEditor({ item, context, onClose, onSaved }: EditorProps) {
  const { modal } = App.useApp(), screens = Grid.useBreakpoint();
  const [form] = Form.useForm<CreateSalaryComponentInput>();
  const [conflicted, setConflicted] = useState(false);
  const latest = item?.versions[0];
  const nextAfterLatest = latest ? new Date(new Date(latest.effectiveFrom + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10) : context.minimumSuccessorDate;
  const minimumDate = nextAfterLatest > context.minimumSuccessorDate ? nextAfterLatest : context.minimumSuccessorDate;
  const mutation = useMutation({
    mutationFn: (values: CreateSalaryComponentInput) => {
      const { orgUnitId, code, ...fields } = values;
      const input: SalaryComponentInput = { ...fields, effectiveTo: fields.effectiveTo || undefined };
      return item ? salaryComponentsApi.createVersion(item.id, { ...input, revision: item.revision }) : salaryComponentsApi.create({ ...input, orgUnitId, code });
    },
    onSuccess: result => { form.resetFields(); onSaved(result.item.code); },
    onError: error => { if (error instanceof ApiError && error.status === 409) setConflicted(true); },
  });
  const close = () => {
    if (mutation.isPending) return;
    if (!form.isFieldsTouched()) { onClose(); return; }
    modal.confirm({ title: "Bỏ thay đổi chưa lưu?", content: "Dữ liệu trong biểu mẫu chưa được lưu. Danh mục hiện có không bị thay đổi.", okText: "Bỏ thay đổi", cancelText: "Tiếp tục nhập", onOk: onClose });
  };
  return <Drawer open title={item ? `Tạo phiên bản kế tiếp · ${item.code}` : "Tạo cấu phần lương"} width={screens.md ? 780 : "100%"} onClose={close} maskClosable={!mutation.isPending} className="salary-component-editor" footer={<Space wrap>
    <Button onClick={close} disabled={mutation.isPending}>Đóng</Button>
    <Button type="primary" onClick={() => form.submit()} loading={mutation.isPending} disabled={conflicted}>{item ? "Lưu phiên bản kế tiếp" : "Tạo cấu phần"}</Button>
  </Space>}>
    <Alert type="info" showIcon message={item ? "Không sửa phiên bản đã lưu" : "Danh mục phân loại, chưa có mức tiền"} description={item ? `Bản mới bắt đầu sớm nhất ${day(minimumDate)}. Không thay đổi nội dung bản trước; nếu đang liên tục hiệu lực, bản trước kết thúc vào ngày liền trước bản mới.` : "Các phân loại BH, thuế, OT và phân bổ theo công độc lập. Lựa chọn này không thay thế căn cứ pháp lý hoặc chứng từ nghiệp vụ."} />
    {mutation.isError && <Alert type="error" showIcon message={conflicted ? "Chưa lưu — cần tải lại danh mục" : "Chưa lưu cấu phần"} description={errorMessage(mutation.error)} action={conflicted ? <Button onClick={() => { modal.confirm({ title: "Đóng biểu mẫu và tải danh mục mới?", content: "Thông tin chưa lưu sẽ không được gửi lại tự động.", okText: "Đóng và tải lại", cancelText: "Giữ biểu mẫu", onOk: onClose }); }}>Tải danh mục mới</Button> : undefined} />}
    <Form name="salary-component-editor" form={form} layout="vertical" onFinish={values => mutation.mutate(values)} disabled={mutation.isPending} initialValues={latest ? { ...latest, effectiveFrom: minimumDate, effectiveTo: undefined, decisionReference: "", reason: "", orgUnitId: item?.orgUnitId, code: item?.code } : { orgUnitId: context.managementUnits[0]?.id, componentType: "EARNING", active: true, isInsurable: false, taxClassification: "TAXABLE", isOtBase: false, isProrated: false, displayOrder: 0, status: "SIMULATION", effectiveFrom: context.asOf }}>
      {item ? <Paragraph className="salary-component-scope"><strong>{item.orgUnitName}</strong> · Mã {item.code} · Phiên bản danh mục {item.revision}</Paragraph> : <div className="salary-component-form-grid">
        <Form.Item name="orgUnitId" label="Đơn vị áp dụng" rules={[{ required: true, message: "Chọn công ty hoặc cơ sở." }]}><Select ref={preserveRequiredCombobox} options={context.managementUnits.map(unit => ({ value: unit.id, label: `${unit.code} · ${unit.name}` }))} /></Form.Item>
        <Form.Item name="code" label="Mã cấu phần" extra="2–32 ký tự: chữ hoa, số, dấu gạch dưới. Không đổi sau khi tạo." rules={[...required, { pattern: /^[A-Z][A-Z0-9_]{1,31}$/, message: "Mã bắt đầu bằng chữ hoa; dùng chữ hoa, số hoặc dấu gạch dưới." }]}><Input maxLength={32} /></Form.Item>
      </div>}
      <Form.Item name="name" label="Tên cấu phần" rules={required}><Input maxLength={150} /></Form.Item>
      <div className="salary-component-form-grid">
        <Form.Item name="componentType" label="Loại khoản" rules={[{ required: true }]}><Select ref={preserveRequiredCombobox} options={Object.entries(componentTypes).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="displayOrder" label="Thứ tự hiển thị" rules={[{ required: true, type: "integer", min: 0, max: 9999, message: "Nhập số nguyên từ 0 đến 9999." }]}><InputNumber min={0} max={9999} precision={0} className="salary-component-number" /></Form.Item>
        <Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={[...required, { validator: (_, value: string) => item && value < minimumDate ? Promise.reject(new Error(`Chọn ngày từ ${day(minimumDate)}.`)) : Promise.resolve() }]}><Input type="date" min={item ? minimumDate : "1900-01-01"} max="9999-12-31" /></Form.Item>
        <Form.Item name="effectiveTo" label="Hiệu lực đến" dependencies={["effectiveFrom"]} extra="Để trống nếu không thời hạn." rules={[({ getFieldValue }) => ({ validator: (_, value: string) => value && value < getFieldValue("effectiveFrom") ? Promise.reject(new Error("Ngày kết thúc không được trước ngày bắt đầu.")) : Promise.resolve() })]}><Input type="date" max="9999-12-31" /></Form.Item>
      </div>
      <fieldset className="salary-component-classification"><legend>Phân loại độc lập</legend>
        <Form.Item name="isInsurable" valuePropName="checked"><Checkbox>Tính đóng bảo hiểm</Checkbox></Form.Item>
        <Form.Item name="taxClassification" label="Phân loại thuế" rules={[{ required: true }]}><Select ref={preserveRequiredCombobox} options={Object.entries(taxClasses).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="isOtBase" valuePropName="checked"><Checkbox>Tính vào căn cứ tiền lương OT</Checkbox></Form.Item>
        <Form.Item name="isProrated" valuePropName="checked"><Checkbox>Phân bổ theo công được trả</Checkbox></Form.Item>
        <Form.Item name="active" valuePropName="checked"><Checkbox>Cho phép áp dụng trong khoảng hiệu lực</Checkbox></Form.Item>
      </fieldset>
      <Form.Item name="classificationBasis" label="Căn cứ phân loại" extra="Nêu căn cứ cho BH, thuế, OT và cách phân bổ; khoản theo điều kiện cần ghi rõ điều kiện/hạn mức." rules={required}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      <div className="salary-component-form-grid">
        <Form.Item name="status" label="Nguồn cấu hình" rules={[{ required: true }]}><Select ref={preserveRequiredCombobox} options={provenanceOptions} /></Form.Item>
        <Form.Item name="decisionReference" label="Quyết định / chứng từ" rules={required}><Input maxLength={500} /></Form.Item>
      </div>
      <Form.Item name="reason" label="Lý do tạo / thay đổi" rules={required}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
    </Form>
  </Drawer>;
}

export function SalaryComponentsWorkspace({ user }: { user: AuthUser }) {
  const client = useQueryClient();
  const screens = Grid.useBreakpoint();
  const [filterForm] = Form.useForm<SalaryComponentFilter>();
  const [filter, setFilter] = useState<SalaryComponentFilter>({});
  const [editor, setEditor] = useState<{ item?: SalaryComponent }>();
  const [historyId, setHistoryId] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const context = useQuery({ queryKey: ["salary-components-context"], queryFn: salaryComponentsApi.context });
  const list = useQuery({ queryKey: ["salary-components", filter], queryFn: () => salaryComponentsApi.list(filter), enabled: context.isSuccess });
  useEffect(() => { if (context.isError || list.isError) { setEditor(undefined); setHistoryId(undefined); } }, [context.isError, list.isError]);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["salary-components"] }); void client.invalidateQueries({ queryKey: ["salary-component"] }); void client.invalidateQueries({ queryKey: ["salary-components-context"] }); };
  const rows = list.isError ? [] : list.data?.items ?? [];
  const columns: ColumnsType<SalaryComponent> = [
    { title: "Cấu phần", key: "name", width: 240, fixed: screens.md ? "left" : undefined, render: (_, row) => <><strong>{row.activeVersion?.name ?? row.versions[0]?.name ?? row.code}</strong><div className="salary-component-secondary">{row.code}</div>{!row.activeVersion ? <Tag>Không hiệu lực ngày đang xem</Tag> : !row.activeVersion.active ? <Tag>Ngừng áp dụng</Tag> : null}</> },
    { title: "Đơn vị áp dụng", dataIndex: "orgUnitName", width: 200 },
    { title: "Loại khoản", key: "type", width: 160, render: (_, row) => row.activeVersion ? componentTypes[row.activeVersion.componentType] : "Không áp dụng" },
    { title: "BH", key: "si", width: 75, render: (_, row) => row.activeVersion ? flag(row.activeVersion.isInsurable) : "—" },
    { title: "Phân loại thuế", key: "tax", width: 190, render: (_, row) => row.activeVersion ? taxClasses[row.activeVersion.taxClassification] : "Không áp dụng" },
    { title: "Căn cứ OT", key: "ot", width: 110, render: (_, row) => row.activeVersion ? flag(row.activeVersion.isOtBase) : "—" },
    { title: "Theo công", key: "prorate", width: 110, render: (_, row) => row.activeVersion ? flag(row.activeVersion.isProrated) : "—" },
    { title: "Hiệu lực", key: "dates", width: 230, render: (_, row) => row.activeVersion ? <>{windowText(row.activeVersion)}<div>{provenance(row.activeVersion)}</div></> : "Chưa có phiên bản cho ngày này" },
    { title: "Thao tác", key: "actions", width: 190, fixed: screens.md ? "right" : undefined, render: (_, row) => <Space direction="vertical" size={0}><Button type="link" icon={<HistoryOutlined />} onClick={() => setHistoryId(row.id)}>Lịch sử</Button>{row.canManage && user.permissions.includes("payroll.components.manage") && <Button type="link" onClick={() => { setSaved(undefined); setEditor({ item: row }); }}>Phiên bản kế tiếp</Button>}</Space> },
  ];
  return <section className="salary-components-workspace" aria-labelledby="salary-components-title">
    <div className="salary-component-heading"><div><Title id="salary-components-title" level={1}>Cấu phần lương</Title><Paragraph type="secondary">Danh mục thu nhập, khấu trừ và chi phí theo đơn vị, ngày hiệu lực. Chưa phải bảng lương hoặc kết quả tính tiền.</Paragraph></div>{context.isSuccess && !!context.data.managementUnits.length && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSaved(undefined); setEditor({}); }}>Tạo cấu phần</Button>}</div>
    {!user.permissions.includes("payroll.components.manage") && <Alert type="info" showIcon message="Chỉ đọc danh mục" description="Tài khoản chưa có quyền quản lý cấu phần lương." />}
    {saved && <Alert type="success" showIcon closable onClose={() => setSaved(undefined)} message={`Đã lưu cấu phần ${saved}`} description="Đã lưu phiên bản và lịch sử; chưa phát sinh khoản tiền hoặc bảng lương." />}
    {context.isError ? <Alert type="error" showIcon message="Không thể tải phạm vi" description={errorMessage(context.error)} action={<Button onClick={() => void context.refetch()}>Tải lại</Button>} /> : context.isPending ? <Skeleton active /> : <>
      <Form name="salary-component-filter" form={filterForm} layout="vertical" className="salary-component-filters" onFinish={values => { setSaved(undefined); setFilter({ ...values, search: values.search?.trim() }); }} initialValues={{ asOf: context.data.asOf }}>
        <Form.Item name="orgUnitId" label="Đơn vị áp dụng"><Select allowClear placeholder="Tất cả đơn vị được xem" options={context.data.units.map(unit => ({ value: unit.id, label: `${unit.code} · ${unit.name}${context.data.managementUnits.some(managed => managed.id === unit.id) ? "" : " · Chỉ đọc"}` }))} /></Form.Item>
        <Form.Item name="asOf" label="Ngày xem hiệu lực" rules={required}><Input type="date" min="1900-01-01" max="9999-12-31" /></Form.Item>
        <Form.Item name="search" label="Mã hoặc tên cấu phần"><Input allowClear maxLength={150} placeholder="Tìm trong danh mục và lịch sử" /></Form.Item>
        <Form.Item label="Thao tác"><Space wrap><Button htmlType="submit" icon={<SearchOutlined />}>Áp dụng</Button><Button icon={<ReloadOutlined />} onClick={refresh} aria-label="Tải lại danh mục" /></Space></Form.Item>
      </Form>
      <Paragraph className="salary-component-secondary">Ngày xem: {day(list.data?.asOf ?? context.data.asOf)} · {rows.length} cấu phần. Danh mục cấp công ty được xem chung; chỉ sửa tại đơn vị được cấp quyền.</Paragraph>
      {list.isError ? <Alert type="error" showIcon message="Không thể tải danh mục" description={errorMessage(list.error)} action={<Button onClick={() => void list.refetch()}>Tải lại</Button>} /> : <Table<SalaryComponent> rowKey="id" columns={columns} dataSource={rows} loading={list.isFetching} components={tableComponents} scroll={{ x: 1605 }} pagination={{ pageSize: 20, showSizeChanger: false }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có cấu phần trong phạm vi và bộ lọc này" /> }} />}
      {editor && <ComponentEditor key={editor.item ? editor.item.id + ":" + editor.item.revision : "create"} item={editor.item} context={context.data} onClose={() => { setEditor(undefined); refresh(); }} onSaved={code => { setEditor(undefined); setSaved(code); refresh(); }} />}
      {historyId && <ComponentHistory id={historyId} asOf={filter.asOf} onClose={() => setHistoryId(undefined)} />}
    </>}
  </section>;
}
