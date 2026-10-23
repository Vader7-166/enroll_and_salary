import { HistoryOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Descriptions, Divider, Drawer, Empty, Form, Grid, Input, Select, Skeleton, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { ApiError, errorMessage } from "../api/client";
import { employeePayPlansApi } from "../api/employee-pay-plans";
import type { PayMode, PayPlan, PayPlanContext, PayPlanEmployee, PayPlanFilter, PayPlanLineRole, PayPlanSourceType, PlanLine, PlanVersion, PlanVersionInput } from "../api/employee-pay-plans";
import type { AuthUser } from "../api/hrtp";

const { Title, Paragraph, Text } = Typography;
const required = [{ required: true, whitespace: true, message: "Nhập thông tin bắt buộc." }];
const payModes: Array<{ value: PayMode; label: string; baseSource: PayPlanSourceType }> = [
  { value: "MONTHLY", label: "Theo tháng", baseSource: "TIME" },
  { value: "DAILY", label: "Theo ngày", baseSource: "TIME" },
  { value: "HOURLY", label: "Theo giờ", baseSource: "TIME" },
  { value: "PRODUCT", label: "Theo sản phẩm", baseSource: "PRODUCT" },
  { value: "PIECEWORK", label: "Khoán", baseSource: "PIECEWORK" },
  { value: "COMMISSION", label: "Hoa hồng", baseSource: "COMMISSION" },
  { value: "THREE_P", label: "Lương 3P", baseSource: "THREE_P" },
];
const statuses = [{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }];
const roles: Array<{ value: PayPlanLineRole; label: string }> = [{ value: "BASE", label: "Nguồn chính" }, { value: "ADDITIONAL", label: "Bổ sung" }, { value: "NOT_APPLICABLE", label: "Không áp dụng" }];
const sources: Array<{ value: PayPlanSourceType; label: string }> = [
  { value: "TIME", label: "Thời gian" }, { value: "PRODUCT", label: "Sản phẩm" }, { value: "PIECEWORK", label: "Khoán" }, { value: "COMMISSION", label: "Hoa hồng" }, { value: "THREE_P", label: "3P" }, { value: "ALLOWANCE", label: "Phụ cấp" }, { value: "BONUS", label: "Thưởng" }, { value: "DEDUCTION", label: "Khấu trừ" }, { value: "EMPLOYER_COST", label: "Chi phí doanh nghiệp" },
];
const allocations = [{ value: "INDIVIDUAL", label: "Cá nhân" }, { value: "CONFIRMED_TEAM_ALLOCATION", label: "Phân bổ tổ đã xác nhận" }];
const dateText = (value: string) => value.split("-").reverse().join("/");
const periodText = (version: PlanVersion) => `${dateText(version.effectiveFrom)} – ${version.effectiveTo ? dateText(version.effectiveTo) : "Không thời hạn"}`;
const statusTag = (status: PlanVersion["status"]) => <Tag color={status === "SIMULATION" ? "warning" : "success"}>{status === "SIMULATION" ? "Mô phỏng" : "Đã xác nhận nghiệp vụ"}</Tag>;
const planModeLabel = (mode: PayMode) => payModes.find((item) => item.value === mode)?.label ?? mode;
const sourceLabel = (source: PayPlanSourceType) => sources.find((item) => item.value === source)?.label ?? source;
const roleLabel = (role: PayPlanLineRole) => roles.find((item) => item.value === role)?.label ?? role;
function preserveRequiredCombobox(select: { nativeElement?: HTMLElement | null } | null) { select?.nativeElement?.removeAttribute("aria-required"); }
function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} tabIndex={0} aria-label="Bảng kế hoạch trả lương; dùng phím mũi tên để cuộn" />; }
const tableComponents = { body: { wrapper: TableBody } };

type EditorValues = PlanVersionInput & { employeeId?: string; employeeScopeId?: string };
function clean(values: EditorValues): PlanVersionInput {
  return {
    name: values.name.trim(), payMode: values.payMode, status: values.status,
    decisionReference: values.decisionReference.trim(), reason: values.reason.trim(), effectiveFrom: values.effectiveFrom,
    ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : {}),
    lines: values.lines.map((line) => ({
      componentId: line.componentId, role: line.role, sourceType: line.sourceType,
      sourceReference: line.sourceReference.trim(), allocation: line.role === "NOT_APPLICABLE" ? "INDIVIDUAL" : line.allocation,
      ...(line.role === "NOT_APPLICABLE" ? {} : line.formulaCode ? { formulaCode: line.formulaCode } : {}),
      ...(line.role === "NOT_APPLICABLE" ? {} : line.separateDecisionReference?.trim() ? { separateDecisionReference: line.separateDecisionReference.trim() } : {}),
      ...(line.role === "NOT_APPLICABLE" ? {} : line.allocationReference?.trim() ? { allocationReference: line.allocationReference.trim() } : {}),
    })),
  };
}
function componentNames(items: Array<{ id: string; code: string; name: string }>) {
  return new Map(items.map(item => [item.id, `${item.code} · ${item.name}`]));
}


function VersionDetails({ version, names }: { version: PlanVersion; names: Map<string, string> }) {
  return <Descriptions bordered size="small" column={1} items={[
    { key: "name", label: "Tên kế hoạch", children: version.name },
    { key: "mode", label: "Phương thức trả", children: planModeLabel(version.payMode) },
    { key: "period", label: "Thời hạn", children: periodText(version) },
    { key: "status", label: "Nguồn xác nhận", children: statusTag(version.status) },
    { key: "decision", label: "Quyết định / chứng từ", children: version.decisionReference },
    { key: "reason", label: "Lý do", children: version.reason },
    { key: "lines", label: "Quy tắc cấu phần", children: <Space direction="vertical" size={8} style={{ width: "100%" }}>{version.lines.map((line, index) => <div className="pay-plan-line-summary" key={line.id ?? `${line.componentId}-${index}`}><strong>{names.get(line.componentId) ?? "Cấu phần lương theo hồ sơ"}</strong><span>{roleLabel(line.role)} · {sourceLabel(line.sourceType)}</span><span>Nguồn/căn cứ: {line.sourceReference}</span>{line.formulaCode && <span>Công thức: {line.formulaCode}</span>}{line.separateDecisionReference && <span>Quyết định riêng: {line.separateDecisionReference}</span>}<span>Phân bổ: {line.allocation === "CONFIRMED_TEAM_ALLOCATION" ? "Tổ đã xác nhận" : "Cá nhân"}{line.allocationReference ? ` · ${line.allocationReference}` : ""}</span></div>)}</Space> },
    { key: "creator", label: "Người tạo", children: version.createdBy.displayName },
    { key: "createdAt", label: "Thời điểm tạo", children: new Date(version.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) },
  ]} />;
}

function PlanHistory({ item, asOf, context, onClose, onNext }: { item: PayPlan; asOf?: string; context: PayPlanContext; onClose: () => void; onNext: () => void }) {
  const screens = Grid.useBreakpoint();
  const detail = useQuery({ queryKey: ["employee-pay-plan", item.id, asOf], queryFn: () => employeePayPlansApi.detail(item.id, asOf) });
  const plan = detail.data?.item;
  const catalogues = useQuery({
    queryKey: ["employee-pay-plan-history-catalogue", plan?.id, plan?.orgUnitId, plan?.versions.map((version) => version.effectiveFrom).join(",")],
    queryFn: async () => {
      const entries = await Promise.all(plan!.versions.map(async version => [version.id, componentNames((await employeePayPlansApi.catalogue(plan!.employeeId, version.effectiveFrom)).components)] as const));
      return new Map(entries);
    },
    enabled: Boolean(plan),
  });
  const names = (version: PlanVersion) => catalogues.data?.get(version.id) ?? new Map<string, string>();
  return <Drawer open title={plan ? `Lịch sử kế hoạch · ${plan.employeeName}` : "Lịch sử kế hoạch trả lương"} width={screens.md ? 820 : "100%"} onClose={onClose} className="employee-pay-plan-history" extra={plan?.canManage ? <Button icon={<PlusOutlined />} type="primary" onClick={onNext}>Phiên bản kế tiếp</Button> : null}>
    {detail.isLoading ? <Skeleton active /> : detail.isError ? <Alert type="error" showIcon message="Không tải được lịch sử" description={errorMessage(detail.error)} /> : !plan ? <Empty description="Không có dữ liệu" /> : <Space direction="vertical" size={16} tabIndex={0} role="region" aria-label="Lịch sử phương án lương; dùng phím mũi tên để cuộn" style={{ width: "100%" }}>
      <Descriptions bordered size="small" column={1} items={[{ key: "employee", label: "Nhân viên", children: `${plan.employeeCode} · ${plan.employeeName}` }, { key: "site", label: "Đơn vị chính", children: `${plan.orgUnitCode} · ${plan.orgUnitName}` }, { key: "revision", label: "Phiên bản dữ liệu", children: plan.revision }]} />
      {plan.versions.map((version) => <section key={version.id} className="pay-plan-history-version"><Title level={3}>Hiệu lực {periodText(version)}</Title><VersionDetails version={version} names={names(version)} /></section>)}
    </Space>}
  </Drawer>;
}

function PlanEditor({ item: sourceItem, context, onClose, onSaved }: { item?: PayPlan; context: PayPlanContext; onClose: () => void; onSaved: (item: PayPlan) => void }) {
  const { modal, message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<EditorValues>();
  const [item, setItem] = useState(sourceItem);
  const [selectedEmployee, setSelectedEmployee] = useState<PayPlanEmployee>();
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const effectiveFrom = Form.useWatch("effectiveFrom", form);
  const employeeScopeId = Form.useWatch("employeeScopeId", form);
  const selectedMode = Form.useWatch("payMode", form);
  const employeeQuery = useQuery({ queryKey: ["employee-pay-plan-employees", employeeScopeId, effectiveFrom, employeeSearch], queryFn: () => employeePayPlansApi.employees({ orgUnitId: employeeScopeId, asOf: effectiveFrom, search: employeeSearch || undefined, page: 1, pageSize: 30 }), enabled: !item && Boolean(employeeScopeId && effectiveFrom) });
  const datedEmployee = useQuery({ queryKey: ["employee-pay-plan-successor-employee", item?.employeeId, effectiveFrom], queryFn: () => employeePayPlansApi.employees({ asOf: effectiveFrom, search: item!.employeeCode, page: 1, pageSize: 30 }), enabled: Boolean(item && effectiveFrom) });
  const activeEmployee = item ? datedEmployee.data?.items.find((employee) => employee.id === item.employeeId) : selectedEmployee;
  const catalogueUnit = activeEmployee?.orgUnitId;
  const catalogueDate = effectiveFrom;
  const catalogue = useQuery({ queryKey: ["employee-pay-plan-catalogue", activeEmployee?.id, catalogueDate], queryFn: () => employeePayPlansApi.catalogue(activeEmployee!.id, catalogueDate!), enabled: Boolean(activeEmployee && catalogueDate) });
  const componentOptions = (catalogue.data?.components ?? []).map(component => ({ value: component.id, label: `${component.code} · ${component.name}` }));
  const formulaOptions = (catalogue.data?.formulae ?? []).map(formula => ({ value: formula.code, label: `${formula.code} · ${formula.name}`, componentId: formula.componentId }));
  const mutation = useMutation({
    mutationFn: (values: EditorValues) => item ? employeePayPlansApi.createVersion(item.id, item.revision, clean(values)) : employeePayPlansApi.create(values.employeeId!, clean(values)),
    onSuccess: ({ item: saved }) => { queryClient.invalidateQueries({ queryKey: ["employee-pay-plans"] }); queryClient.invalidateQueries({ queryKey: ["employee-pay-plan", saved.id] }); message.success(item ? "Đã tạo phiên bản kế tiếp." : "Đã tạo kế hoạch trả lương."); onSaved(saved); },
    onError: (error) => { if (error instanceof ApiError && error.status === 409 && item) setConflicted(true); else message.error(errorMessage(error)); },
  });
  useEffect(() => {
    if (sourceItem) {
      setItem(sourceItem);
      const latest = sourceItem.versions[0];
      form.setFieldsValue({ ...latest, effectiveFrom: undefined, effectiveTo: undefined, lines: latest?.lines.map(({ id: _id, ...line }) => ({ ...line })) });
    }
  }, [sourceItem, form]);
  const reloadAfterConflict = async () => {
    if (!item) return;
    try {
      const refreshed = (await employeePayPlansApi.detail(item.id)).item;
      setItem(refreshed); setConflicted(false);
      queryClient.invalidateQueries({ queryKey: ["employee-pay-plans"] });
      message.success("Đã tải phiên bản mới. Bản nháp đang nhập được giữ lại; hãy kiểm tra ngày hiệu lực trước khi lưu lại.");
    } catch (error) { message.error(errorMessage(error)); }
  };
  const close = () => {
    if (mutation.isPending) return;
    if (!form.isFieldsTouched()) { onClose(); return; }
    modal.confirm({ title: "Đóng biểu mẫu?", content: "Các thay đổi chưa lưu sẽ bị bỏ.", okText: "Bỏ thay đổi", cancelText: "Tiếp tục chỉnh sửa", okButtonProps: { danger: true }, onOk: onClose });
  };
  const chooseEmployee = (employeeId: string) => setSelectedEmployee(employeeQuery.data?.items.find((entry) => entry.id === employeeId));
  const onValuesChange = (changed: Partial<EditorValues>) => {
    if (!item && (changed.effectiveFrom !== undefined || changed.employeeScopeId !== undefined)) { form.setFieldValue("employeeId", undefined); setSelectedEmployee(undefined); }
  };
  const baseSource = payModes.find((mode) => mode.value === selectedMode)?.baseSource;
  return <Drawer open title={item ? `Phiên bản kế tiếp · ${item.employeeName}` : "Tạo kế hoạch trả lương"} width={screens.md ? 920 : "100%"} onClose={close} maskClosable={!mutation.isPending} className="employee-pay-plan-editor" footer={<Space wrap><Button onClick={close} disabled={mutation.isPending}>Hủy</Button><Button type="primary" loading={mutation.isPending} onClick={() => form.submit()}>{item ? "Lưu phiên bản kế tiếp" : "Tạo kế hoạch"}</Button></Space>}>
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="Khai báo kế hoạch, không tính lương" description="Nguồn, công thức và phương thức phân bổ chỉ là quy tắc áp dụng. Hệ thống không ghi nhận sản lượng, phân bổ thực tế hoặc tính tiền lương tại đây." />
      {conflicted && <Alert type="warning" showIcon message="Dữ liệu đã có phiên bản mới" description="Bản nháp của bạn vẫn được giữ. Tải lại phiên bản trước khi kiểm tra và lưu lại." action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void reloadAfterConflict()}>Tải lại phiên bản</Button>} />}
      <Form form={form} layout="vertical" requiredMark="optional" onFinish={(values) => mutation.mutate(values)} onValuesChange={onValuesChange}>
        {!item && <><Title level={3}>Nhân viên và hiệu lực</Title><div className="pay-plan-editor-grid"><Form.Item name="effectiveFrom" label="Ngày bắt đầu hiệu lực" rules={[{ required: true, message: "Chọn ngày bắt đầu hiệu lực." }]}><Input type="date" aria-label="Ngày bắt đầu hiệu lực" /></Form.Item><Form.Item name="employeeScopeId" label="Phạm vi tìm nhân viên" rules={[{ required: true, message: "Chọn phạm vi tìm nhân viên." }]}><Select ref={preserveRequiredCombobox} placeholder="Chọn công ty hoặc cơ sở" options={context.managementUnits.map((unit) => ({ value: unit.id, label: `${unit.code} · ${unit.name}` }))} /></Form.Item></div><Form.Item name="employeeId" label="Nhân viên" rules={[{ required: true, message: "Chọn nhân viên." }]} extra={!effectiveFrom || !employeeScopeId ? "Chọn ngày hiệu lực và phạm vi trước." : "Danh sách dựa trên đơn vị chính của nhân viên tại ngày hiệu lực."}><Select ref={preserveRequiredCombobox} showSearch filterOption={false} disabled={!effectiveFrom || !employeeScopeId} loading={employeeQuery.isFetching} onSearch={setEmployeeSearch} onChange={chooseEmployee} placeholder="Tìm theo mã hoặc họ tên" options={(employeeQuery.data?.items ?? []).map((employee) => ({ value: employee.id, label: `${employee.code} · ${employee.fullName} — ${employee.orgUnitName}` }))} notFoundContent={employeeQuery.isFetching ? <Skeleton active paragraph={false} /> : "Không có nhân viên trong phạm vi này"} /></Form.Item></>}
        {activeEmployee && <Descriptions bordered size="small" column={1} className="pay-plan-employee-card" items={[{ key: "employee", label: "Nhân viên", children: `${activeEmployee.code} · ${activeEmployee.fullName}` }, { key: "site", label: "Đơn vị chính tại ngày hiệu lực", children: `${activeEmployee.orgUnitCode} · ${activeEmployee.orgUnitName}` }]} />}
        {item && <Form.Item name="effectiveFrom" label="Ngày bắt đầu hiệu lực" rules={[{ required: true, message: "Chọn ngày bắt đầu hiệu lực." }]} extra={`Phiên bản kế tiếp phải từ ${dateText(context.minimumSuccessorDate)}.`}><Input type="date" min={context.minimumSuccessorDate} aria-label="Ngày bắt đầu hiệu lực" /></Form.Item>}
        <Divider />
        <Title level={3}>Phiên bản kế hoạch</Title><div className="pay-plan-editor-grid"><Form.Item name="name" label="Tên kế hoạch" rules={required}><Input maxLength={200} /></Form.Item><Form.Item name="payMode" label="Phương thức trả" rules={[{ required: true, message: "Chọn phương thức trả." }]}><Select ref={preserveRequiredCombobox} placeholder="Chọn phương thức" options={payModes.map(({ value, label }) => ({ value, label }))} /></Form.Item><Form.Item name="status" label="Nguồn xác nhận" rules={[{ required: true, message: "Chọn nguồn xác nhận." }]}><Select ref={preserveRequiredCombobox} placeholder="Chọn trạng thái" options={statuses} /></Form.Item><Form.Item name="effectiveTo" label="Ngày kết thúc hiệu lực"><Input type="date" aria-label="Ngày kết thúc hiệu lực" /></Form.Item></div>
        <Form.Item name="decisionReference" label="Quyết định / chứng từ" rules={required}><Input maxLength={200} /></Form.Item><Form.Item name="reason" label="Lý do / căn cứ áp dụng" rules={required}><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
        <Divider /><div className="pay-plan-lines-heading"><div><Title level={3}>Quy tắc cấu phần</Title><Text type="secondary">Đầu ra của mọi công thức phải là VND. Công thức và cấu phần được lọc theo đơn vị chính và ngày hiệu lực.</Text></div></div>
        {!catalogueUnit || !catalogueDate ? <Alert type="warning" showIcon message="Chọn nhân viên và ngày hiệu lực để nạp cấu phần, công thức đúng phạm vi." /> : null}
        {catalogue.isError && <Alert type="error" showIcon message="Không tải được cấu phần và công thức" description={errorMessage(catalogue.error)} />}
        <Form.List name="lines" rules={[{ validator: async (_, lines) => { if (!lines?.length) return Promise.reject(new Error("Thêm ít nhất một quy tắc cấu phần.")); } }]}>{(fields, { add, remove }, { errors }) => <><Space direction="vertical" size={16} style={{ width: "100%" }}>{fields.map((field, index) => <PlanLineEditor key={field.key} field={field} index={index} remove={remove} componentOptions={componentOptions} formulaOptions={formulaOptions} baseSource={baseSource} form={form} />)}</Space><Form.ErrorList errors={errors} /><Button icon={<PlusOutlined />} onClick={() => add()} disabled={!catalogueUnit || !catalogueDate}>Thêm quy tắc cấu phần</Button></>}</Form.List>
      </Form>
    </Space>
  </Drawer>;
}

function PlanLineEditor({ field, index, remove, componentOptions, formulaOptions: allFormulaOptions, baseSource, form }: { field: { key: number; name: number }; index: number; remove: (index: number) => void; componentOptions: Array<{ value: string; label: string }>; formulaOptions: Array<{ value: string; label: string; componentId: string }>; baseSource?: PayPlanSourceType; form: FormInstance<EditorValues> }) {
  const role = Form.useWatch(["lines", field.name, "role"], form);
  const componentId = Form.useWatch(["lines", field.name, "componentId"], form);
  const notApplicable = role === "NOT_APPLICABLE";
  const allocation = Form.useWatch(["lines", field.name, "allocation"], form);
  const formulaOptions = allFormulaOptions.filter((formula) => formula.componentId === componentId);
  const sourceOptions = role === "BASE" && baseSource ? sources.filter((option) => option.value === baseSource) : sources;
  const roleChanged = (next: PayPlanLineRole) => { if (next === "NOT_APPLICABLE") { form.setFieldValue(["lines", field.name, "allocation"], "INDIVIDUAL"); form.setFieldValue(["lines", field.name, "formulaCode"], undefined); form.setFieldValue(["lines", field.name, "allocationReference"], undefined); form.setFieldValue(["lines", field.name, "separateDecisionReference"], undefined); } };
  const allocationNeeded = !notApplicable && allocation === "CONFIRMED_TEAM_ALLOCATION";
  return <section className="pay-plan-rule" aria-label={`Quy tắc cấu phần ${index + 1}`}><div className="pay-plan-rule-heading"><strong>Quy tắc {index + 1}</strong><Tooltip title="Xóa quy tắc"><Button type="text" danger icon={<MinusCircleOutlined />} aria-label={`Xóa quy tắc ${index + 1}`} onClick={() => remove(field.name)} /></Tooltip></div><div className="pay-plan-editor-grid"><Form.Item {...field} name={[field.name, "componentId"]} label="Cấu phần lương" rules={[{ required: true, message: "Chọn cấu phần lương." }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" options={componentOptions} placeholder="Chọn cấu phần" /></Form.Item><Form.Item {...field} name={[field.name, "role"]} label="Vai trò" rules={[{ required: true, message: "Chọn vai trò." }]}><Select ref={preserveRequiredCombobox} options={roles} placeholder="Chọn vai trò" onChange={roleChanged} /></Form.Item><Form.Item {...field} name={[field.name, "sourceType"]} label="Loại nguồn" rules={[{ required: true, message: "Chọn loại nguồn." }]}><Select ref={preserveRequiredCombobox} options={sourceOptions} placeholder={role === "BASE" && !baseSource ? "Chọn phương thức trả trước" : "Chọn loại nguồn"} disabled={role === "BASE" && !baseSource} /></Form.Item><Form.Item {...field} name={[field.name, "allocation"]} label="Phương thức phân bổ" rules={[{ required: true, message: "Chọn phương thức phân bổ." }]}><Select ref={preserveRequiredCombobox} options={allocations} disabled={notApplicable} placeholder="Chọn phương thức" /></Form.Item></div><Form.Item {...field} name={[field.name, "sourceReference"]} label={notApplicable ? "Lý do không áp dụng" : "Nguồn / quyết định / căn cứ nhận diện"} rules={required} extra={notApplicable ? "Nêu rõ vì sao cấu phần này không áp dụng cho nhân viên." : "Không phải xác nhận lô dữ liệu hay xác nhận phân bổ thực tế."}><Input maxLength={500} /></Form.Item>{!notApplicable && <div className="pay-plan-editor-grid"><Form.Item {...field} name={[field.name, "formulaCode"]} label="Công thức VND" rules={[{ required: true, message: "Chọn công thức VND." }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" options={formulaOptions} placeholder="Chọn công thức" /></Form.Item><Form.Item {...field} name={[field.name, "separateDecisionReference"]} label="Quyết định riêng (nếu bổ sung)" extra="Bắt buộc khi chi trả bổ sung dùng cùng nguồn hoặc công thức phụ thuộc một khoản chi trả khác."><Input maxLength={200} /></Form.Item>{allocationNeeded && <Form.Item {...field} name={[field.name, "allocationReference"]} label="Tham chiếu phân bổ tổ" rules={[{ required: true, message: "Nhập tham chiếu phân bổ tổ đã xác nhận." }]}><Input maxLength={200} /></Form.Item>}</div>}</section>;
}

export function EmployeePayPlansWorkspace({ user: _user }: { user: AuthUser }) {
  const [asOf, setAsOf] = useState("");
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editorItem, setEditorItem] = useState<PayPlan | null | undefined>();
  const [historyItem, setHistoryItem] = useState<PayPlan>();
  const context = useQuery({ queryKey: ["employee-pay-plans-context"], queryFn: employeePayPlansApi.context });
  useEffect(() => { if (!asOf && context.data?.asOf) setAsOf(context.data.asOf); }, [asOf, context.data?.asOf]);
  const filter: PayPlanFilter = { asOf: asOf || undefined, orgUnitId, search: search || undefined, page, pageSize: 20 };
  const list = useQuery({ queryKey: ["employee-pay-plans", filter], queryFn: () => employeePayPlansApi.list(filter), enabled: context.isSuccess && Boolean(asOf) });
  useEffect(() => { setPage(1); }, [asOf, orgUnitId, search]);
  const columns: ColumnsType<PayPlan> = [
    { title: "Nhân viên", key: "employee", fixed: "left", width: 260, render: (_, row) => <><strong>{row.employeeCode}</strong><br /><span>{row.employeeName}</span></> },
    { title: "Đơn vị chính", key: "unit", width: 230, render: (_, row) => `${row.orgUnitCode} · ${row.orgUnitName}` },
    { title: "Kế hoạch tại ngày xem", key: "plan", width: 250, render: (_, row) => row.activeVersion ? <><strong>{row.activeVersion.name}</strong><br /><span>{planModeLabel(row.activeVersion.payMode)} · {statusTag(row.activeVersion.status)}</span></> : <Text type="secondary">Chưa có phiên bản hiệu lực</Text> },
    { title: "Hiệu lực", key: "period", width: 180, render: (_, row) => row.activeVersion ? periodText(row.activeVersion) : "—" },
    { title: "Thao tác", key: "actions", fixed: "right", width: 180, render: (_, row) => <Space wrap><Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryItem(row)}>Lịch sử</Button>{row.canManage && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setEditorItem(row)}>Phiên bản kế tiếp</Button>}</Space> },
  ];
  const create = () => setEditorItem(null);
  const saved = (plan: PayPlan) => { setEditorItem(undefined); setHistoryItem(plan); list.refetch(); };
  return <section className="workspace employee-pay-plans-workspace" aria-labelledby="employee-pay-plans-title"><div className="page-heading"><div><p className="eyebrow">CẤU HÌNH TRẢ LƯƠNG CÁ NHÂN</p><Title id="employee-pay-plans-title" level={2}>Kế hoạch trả lương nhân viên</Title><Paragraph type="secondary">Khai báo phiên bản kế hoạch theo nhân viên và đơn vị chính; không tạo bảng lương hay kết quả chi trả.</Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={create} disabled={!context.data?.managementUnits.length}>Tạo kế hoạch</Button></div>
    {context.isError ? <Alert type="error" showIcon message="Không tải được phạm vi cấu hình" description={errorMessage(context.error)} /> : context.isLoading ? <Skeleton active /> : <><div className="workspace-filters pay-plan-filters"><div className="workspace-filter"><label htmlFor="pay-plan-as-of">Ngày xem hiệu lực</label><Input id="pay-plan-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></div><div className="workspace-filter"><label htmlFor="pay-plan-unit">Đơn vị</label><Select id="pay-plan-unit" aria-label="Đơn vị" allowClear placeholder="Tất cả phạm vi được phép" value={orgUnitId} onChange={setOrgUnitId} options={context.data?.units.map((unit) => ({ value: unit.id, label: `${unit.code} · ${unit.name}` }))} /></div><form className="workspace-search" onSubmit={(event) => { event.preventDefault(); setSearch(draftSearch); }}><Input aria-label="Tìm theo nhân viên hoặc tên kế hoạch" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Tìm mã, tên nhân viên hoặc kế hoạch" suffix={<SearchOutlined />} /><Button htmlType="submit">Tìm</Button></form></div>
      {list.isError ? <Alert type="error" showIcon message="Không tải được kế hoạch trả lương" description={errorMessage(list.error)} /> : <Table rowKey="id" columns={columns} dataSource={list.data?.items ?? []} loading={list.isLoading || list.isFetching} components={tableComponents} scroll={{ x: 1120 }} pagination={{ current: list.data?.page ?? page, pageSize: list.data?.pageSize ?? 20, total: list.data?.total ?? 0, showSizeChanger: false, onChange: setPage, showTotal: (total) => `${total} kế hoạch` }} locale={{ emptyText: <Empty description="Chưa có kế hoạch trả lương trong phạm vi này" /> }} />}
      {!context.data?.managementUnits.length && <Alert type="warning" showIcon message="Không có phạm vi quản lý để tạo kế hoạch" description="Bạn vẫn chỉ có thể xem các kế hoạch được cấp quyền." />}</>}
    {editorItem !== undefined && <PlanEditor item={editorItem ?? undefined} context={context.data!} onClose={() => setEditorItem(undefined)} onSaved={saved} />}
    {historyItem && <PlanHistory item={historyItem} asOf={asOf} context={context.data!} onClose={() => setHistoryItem(undefined)} onNext={() => { setHistoryItem(undefined); setEditorItem(historyItem); }} />}
  </section>;
}
