import { HistoryOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Descriptions, Drawer, Empty, Form, Grid, Input, InputNumber, Select, Skeleton, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { ApiError, errorMessage } from "../api/client";
import { payrollConfigurationApi } from "../api/payroll-configuration";
import type { CommonConfigurationInput, CreatePayrollConfigurationInput, FormulaConfigurationInput, FormulaRoundingMode, FormulaVariable, FormulaVariableSource, PayrollConfiguration, PayrollConfigurationContext, PayrollConfigurationKind, PayrollConfigurationVersion, PriceConfigurationInput, PriceType, PreviewContext, PreviewResult } from "../api/payroll-configuration";
import { salaryComponentsApi } from "../api/salary-components";
import type { AuthUser } from "../api/hrtp";

const { Title, Paragraph, Text } = Typography;
const required = [{ required: true, whitespace: true, message: "Nhập thông tin bắt buộc." }];
const statuses = [{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }];
const priceTypes: Array<{ value: PriceType; label: string; note: string }> = [
  { value: "MONTHLY", label: "Theo tháng", note: "Đơn giá theo tháng, nêu rõ đơn vị (ví dụ VND/tháng)." },
  { value: "DAILY", label: "Theo ngày", note: "Đơn giá theo ngày, nêu rõ đơn vị (ví dụ VND/ngày)." },
  { value: "HOURLY", label: "Theo giờ", note: "Đơn giá theo giờ, nêu rõ đơn vị (ví dụ VND/giờ)." },
  { value: "PRODUCT", label: "Theo sản phẩm", note: "Bắt buộc mã sản phẩm và đơn vị tính sản phẩm." },
  { value: "PIECEWORK", label: "Khoán", note: "Nêu rõ đơn vị và mã công đoạn nếu áp dụng." },
  { value: "COMMISSION", label: "Hoa hồng", note: "Giá trị từ 0 đến 100, đơn vị phải là %." },
  { value: "P1", label: "P1", note: "Nêu rõ đơn vị và nguồn gốc áp dụng." },
  { value: "P2", label: "P2", note: "Nêu rõ đơn vị và nguồn gốc áp dụng." },
  { value: "P3", label: "P3", note: "Nêu rõ đơn vị và nguồn gốc áp dụng." },
];
const sourceTypes: Array<{ value: FormulaVariableSource; label: string }> = [
  { value: "INPUT", label: "Dữ liệu mẫu" }, { value: "PARAMETER", label: "Tham số pháp lý" }, { value: "PRICE", label: "Đơn giá" }, { value: "FORMULA", label: "Công thức" },
];
const roundingOptions: Array<{ value: FormulaRoundingMode; label: string }> = [
  { value: "NONE", label: "Không làm tròn" }, { value: "HALF_UP", label: "0,5 làm tròn lên" }, { value: "HALF_EVEN", label: "0,5 về số chẵn" }, { value: "DOWN", label: "Về 0" }, { value: "UP", label: "Ra xa 0" }, { value: "FLOOR", label: "Xuống" }, { value: "CEIL", label: "Lên" },
];
function day(value: string) { return value.split("-").reverse().join("/"); }
function dateInput(value?: string | null) { return value ?? undefined; }
function windowText(version: PayrollConfigurationVersion) { return `${day(version.effectiveFrom)} – ${version.effectiveTo ? day(version.effectiveTo) : "Không thời hạn"}`; }
function statusTag(version: PayrollConfigurationVersion) { return <Tag color={version.status === "SIMULATION" ? "warning" : "success"}>{version.status === "SIMULATION" ? "Mô phỏng" : "Đã xác nhận nghiệp vụ"}</Tag>; }
function kindText(kind: PayrollConfigurationKind) { return kind === "PRICE" ? "Đơn giá" : "Công thức"; }
function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} tabIndex={0} aria-label="Bảng đơn giá và công thức; dùng phím mũi tên để cuộn" />; }
const tableComponents = { body: { wrapper: TableBody } };
function removeEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== "" && field !== undefined && field !== null)) as T;
}
function preserveRequiredCombobox(select: { nativeElement?: HTMLElement | null } | null) {
  // rc-select duplicates aria-required on its generic wrapper; keep it on the combobox.
  select?.nativeElement?.removeAttribute("aria-required");
}
function configurationScopes(context: PayrollConfigurationContext, orgUnitId?: string) {
  const scopes = new Set<string>();
  let current = context.units.find(unit => unit.id === orgUnitId);
  while (current && !scopes.has(current.id)) {
    scopes.add(current.id);
    current = context.units.find(unit => unit.id === current!.parentId);
  }
  return scopes;
}
const wholeNumber = new Intl.NumberFormat("vi-VN");
function decimalLabel(value: string) {
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const tail = fraction.replace(/0+$/, "");
  return (negative ? "-" : "") + wholeNumber.format(BigInt(integer)) + (tail ? "," + tail : "");
}

function VersionDetails({ version }: { version: PayrollConfigurationVersion }) {
  const special = "priceType" in version
    ? [{ key: "priceType", label: "Loại đơn giá", children: priceTypes.find((item) => item.value === version.priceType)?.label ?? version.priceType }, { key: "amount", label: "Giá trị", children: <span className="numeric">{decimalLabel(version.amount)} {version.unit}</span> }, { key: "product", label: "Nguồn gốc sản phẩm / công đoạn", children: [version.productCode, version.operationCode].filter(Boolean).join(" · ") || "—" }]
    : [{ key: "component", label: "Cấu phần lương", children: version.componentId }, { key: "expression", label: "Biểu thức", children: <code>{version.expression}</code> }, { key: "rounding", label: "Làm tròn", children: `${roundingOptions.find((item) => item.value === version.roundingMode)?.label ?? version.roundingMode}; ${version.roundingScale} chữ số` }, { key: "variables", label: "Biến khai báo", children: version.variables.length ? version.variables.map((variable) => `${variable.symbol} ← ${variable.source}:${variable.reference} (${variable.unit})`).join("; ") : "Không có" }];
  return <Descriptions size="small" bordered column={1} items={[
    { key: "name", label: "Tên", children: version.name }, { key: "unit", label: "Đơn vị đầu ra", children: version.unit }, { key: "active", label: "Trạng thái áp dụng", children: version.active ? "Đang áp dụng" : "Ngừng áp dụng" }, { key: "time", label: "Thời hạn", children: windowText(version) }, { key: "provenance", label: "Nguồn xác nhận", children: statusTag(version) }, { key: "reason", label: "Lý do", children: version.reason || "—" }, { key: "decision", label: "Quyết định / chứng từ", children: version.decisionReference || "—" }, { key: "createdBy", label: "Người tạo", children: version.createdBy.displayName }, { key: "createdAt", label: "Thời điểm tạo", children: new Date(version.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) }, ...special,
  ]} />;
}

function ConfigurationHistory({ id, asOf, onClose, onSuccessor }: { id: string; asOf: string; onClose: () => void; onSuccessor: (item: PayrollConfiguration) => void }) {
  const screens = Grid.useBreakpoint();
  const query = useQuery({ queryKey: ["payroll-configuration", id, asOf], queryFn: () => payrollConfigurationApi.detail(id, asOf) });
  const item = query.data?.item;
  return <Drawer open title={item ? `Lịch sử · ${item.code}` : "Lịch sử đơn giá / công thức"} width={screens.md ? 820 : "100%"} onClose={onClose} className="payroll-configuration-history">
    {query.isLoading ? <Skeleton active /> : query.isError ? <Alert type="error" showIcon message={errorMessage(query.error)} /> : item ? <Space direction="vertical" size="large" className="full-width">
      <div className="detail-identity"><div className="person-mark">{item.kind === "PRICE" ? "ĐG" : "CT"}</div><div><Title level={2}>{item.code}</Title><Text type="secondary">{item.orgUnitName} · Phiên bản {item.revision}</Text></div><Tag>{kindText(item.kind)}</Tag></div>
      {!item.canManage && <Alert type="info" showIcon message="Bạn chỉ có quyền xem dữ liệu trong phạm vi này." />}
      {item.versions.map((version) => <section key={version.id} className="configuration-version"><Space wrap><Text strong>Hiệu lực {windowText(version)}</Text>{statusTag(version)}</Space><VersionDetails version={version} /></section>)}
      {item.canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => onSuccessor(item)}>Tạo phiên bản kế tiếp</Button>}
    </Space> : <Empty description="Không có dữ liệu lịch sử." />}
  </Drawer>;
}

type EditorValues = CommonConfigurationInput & Partial<PriceConfigurationInput & FormulaConfigurationInput> & { kind?: PayrollConfigurationKind; code?: string; orgUnitId?: string; variables?: FormulaVariable[] };
function ConfigurationEditor({ item, kind, context, onClose, onSaved }: { item?: PayrollConfiguration; kind: PayrollConfigurationKind; context: PayrollConfigurationContext; onClose: () => void; onSaved: (code: string) => void }) {
  const screens = Grid.useBreakpoint();
  const { modal } = App.useApp();
  const [form] = Form.useForm<EditorValues>();
  const [conflicted, setConflicted] = useState(false);
  const latest = item?.versions[0];
  const minimumDate = useMemo(() => {
    if (!item) return "1900-01-01";
    const afterLatest = latest ? new Date(new Date(`${latest.effectiveFrom}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10) : context.minimumSuccessorDate;
    return afterLatest > context.minimumSuccessorDate ? afterLatest : context.minimumSuccessorDate;
  }, [context.minimumSuccessorDate, latest, item]);
  const currentKind = item?.kind ?? kind;
  const currentPriceType = Form.useWatch("priceType", form) as PriceType | undefined;
  const selectedOrgUnitId = (Form.useWatch("orgUnitId", form) as string | undefined) ?? item?.orgUnitId;
  const selectedDate = Form.useWatch("effectiveFrom", form) as string | undefined;
  const componentScopes = useMemo(() => configurationScopes(context, selectedOrgUnitId), [context, selectedOrgUnitId]);
  const componentQuery = useQuery({ queryKey: ["salary-components", "formula-editor", selectedOrgUnitId, selectedDate], queryFn: () => salaryComponentsApi.list({ asOf: selectedDate }), enabled: currentKind === "FORMULA" && Boolean(selectedOrgUnitId && selectedDate) });
  useEffect(() => {
    const version = latest;
    form.setFieldsValue(version ? { ...version, effectiveFrom: minimumDate, effectiveTo: undefined } : { kind: currentKind, active: true, status: "SIMULATION", effectiveFrom: context.asOf, roundingMode: "NONE", roundingScale: 0, variables: [], priceType: "MONTHLY" });
  }, [context.asOf, currentKind, form, latest, minimumDate]);
  const mutation = useMutation({
    mutationFn: async (values: EditorValues) => {
      const common = removeEmpty({ name: values.name, unit: values.unit, active: values.active, status: values.status, decisionReference: values.decisionReference, reason: values.reason, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo });
      const payload = currentKind === "PRICE"
        ? removeEmpty({ ...common, priceType: values.priceType, amount: values.amount, productCode: values.productCode, operationCode: values.operationCode }) as PriceConfigurationInput
        : removeEmpty({ ...common, componentId: values.componentId, expression: values.expression, variables: values.variables ?? [], roundingMode: values.roundingMode, roundingScale: values.roundingScale }) as FormulaConfigurationInput;
      return item ? payrollConfigurationApi.createVersion(item.id, { ...payload, revision: item.revision }) : payrollConfigurationApi.create({ ...payload, kind: currentKind, code: values.code!, orgUnitId: values.orgUnitId! } as CreatePayrollConfigurationInput);
    },
    onSuccess: ({ item: saved }) => onSaved(saved.code),
    onError: (error) => setConflicted(error instanceof ApiError && error.status === 409),
  });
  const requestClose = () => {
    if (!form.isFieldsTouched()) {
      onClose();
      return;
    }
    modal.confirm({ title: "Đóng biểu mẫu?", content: "Các thay đổi chưa lưu sẽ bị bỏ.", okText: "Bỏ thay đổi", cancelText: "Tiếp tục chỉnh sửa", onOk: onClose });
  };
  const submit = async () => { if (conflicted) return; try { await form.validateFields(); mutation.mutate(form.getFieldsValue()); } catch { /* Ant Form renders input errors. */ } };
  const variableRows = <Form.List name="variables">{(fields, { add, remove }) => <div className="variable-editor"><div className="variable-heading"><Text strong>Biến và nguồn dữ liệu</Text><Button icon={<PlusOutlined />} onClick={() => add({ source: "INPUT" })}>Thêm biến</Button></div><Paragraph type="secondary">Khai báo từng biến dùng trong biểu thức. Ký hiệu, nguồn tham chiếu và đơn vị phải khớp chính xác; không quy đổi đơn vị tự động.</Paragraph>{fields.map((field) => <div className="variable-row" key={field.key}><Form.Item name={[field.name, "symbol"]} label="Ký hiệu" rules={required}><Input placeholder="LUONG_THANG" /></Form.Item><Form.Item name={[field.name, "source"]} label="Nguồn" rules={[{ required: true, message: "Chọn nguồn." }]}><Select ref={preserveRequiredCombobox} options={sourceTypes} /></Form.Item><Form.Item name={[field.name, "reference"]} label="Mã tham chiếu" rules={required}><Input placeholder="Mã đơn giá / công thức / tham số / input" /></Form.Item><Form.Item name={[field.name, "unit"]} label="Đơn vị" rules={required}><Input placeholder="VND/tháng" /></Form.Item><Form.Item name={[field.name, "min"]} label="Tối thiểu"><Input inputMode="decimal" placeholder="Không bắt buộc" /></Form.Item><Form.Item name={[field.name, "max"]} label="Tối đa"><Input inputMode="decimal" placeholder="Không bắt buộc" /></Form.Item><Button type="text" danger icon={<MinusCircleOutlined />} aria-label="Xóa biến" onClick={() => remove(field.name)} /></div>)}</div>}</Form.List>;
  return <Drawer open title={item ? `Tạo phiên bản kế tiếp · ${item.code}` : `Tạo ${kindText(currentKind).toLowerCase()}`} width={screens.lg ? 940 : "100%"} onClose={requestClose} maskClosable={!mutation.isPending} className="payroll-configuration-editor" footer={<Space wrap><Button onClick={requestClose} disabled={mutation.isPending}>Hủy</Button><Button type="primary" onClick={submit} loading={mutation.isPending} disabled={conflicted}>Lưu phiên bản</Button></Space>}>
    {conflicted && <Alert type="warning" showIcon message="Dữ liệu đã thay đổi. Biểu mẫu của bạn vẫn được giữ nguyên; hãy tải lại lịch sử để lấy phiên bản mới trước khi lưu." action={<Button size="small" onClick={() => modal.confirm({ title: "Tải lại dữ liệu?", content: "Thay đổi chưa lưu sẽ bị bỏ. Hãy sao chép nội dung cần giữ trước khi tiếp tục.", okText: "Bỏ thay đổi và tải lại", cancelText: "Giữ biểu mẫu", onOk: () => window.location.reload() })}>Tải lại</Button>} />}
    {mutation.isError && !conflicted && <Alert type="error" showIcon message={errorMessage(mutation.error)} />}
    <Form name="payroll-configuration-editor" form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} className="configuration-form">
      <div className="form-grid">
        {!item && <><Form.Item name="code" label="Mã" rules={required}><Input autoComplete="off" placeholder="VD: LUONG_THANG" /></Form.Item><Form.Item name="orgUnitId" label="Đơn vị quản lý" rules={[{ required: true, message: "Chọn đơn vị quản lý." }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" options={context.managementUnits.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} /></Form.Item></>}
        <Form.Item name="name" label="Tên" rules={required}><Input /></Form.Item><Form.Item name="unit" label="Đơn vị đầu ra" rules={required} extra="Nêu rõ ngữ nghĩa, ví dụ VND/tháng, VND/giờ, sản phẩm hoặc %."><Input placeholder="Ví dụ: VND/tháng, VND/giờ, sản phẩm hoặc %" /></Form.Item>
        <Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={[{ required: true, message: "Chọn ngày hiệu lực." }, { validator: (_, value) => !value || value >= minimumDate ? Promise.resolve() : Promise.reject(new Error(`Phải từ ${day(minimumDate)} trở đi.`)) }]}><Input type="date" min={minimumDate} /></Form.Item><Form.Item name="status" label="Nguồn xác nhận" rules={[{ required: true, message: "Chọn trạng thái." }]}><Select ref={preserveRequiredCombobox} options={statuses} /></Form.Item>
        <Form.Item name="effectiveTo" label="Hiệu lực đến" dependencies={["effectiveFrom"]} rules={[{ validator: (_, value) => !value || value >= form.getFieldValue("effectiveFrom") ? Promise.resolve() : Promise.reject(new Error("Ngày kết thúc không được trước ngày bắt đầu.")) }]}><Input type="date" min={selectedDate} /></Form.Item>
        <Form.Item name="decisionReference" label="Quyết định / chứng từ" rules={required}><Input /></Form.Item><Form.Item name="reason" label="Lý do" rules={required}><Input /></Form.Item>
        <Form.Item name="active" valuePropName="checked" className="form-span-2"><Checkbox>Cho phép áp dụng phiên bản này</Checkbox></Form.Item>
      </div>
      {currentKind === "PRICE" ? <section className="configuration-subsection"><Title level={2}>Đơn giá</Title><div className="form-grid"><Form.Item name="priceType" label="Loại đơn giá" rules={[{ required: true, message: "Chọn loại đơn giá." }]}><Select ref={preserveRequiredCombobox} options={priceTypes.map(({ value, label }) => ({ value, label }))} /></Form.Item><Form.Item name="amount" label={currentPriceType === "COMMISSION" ? "Tỷ lệ hoa hồng (%)" : "Giá trị"} rules={required}><Input inputMode="decimal" /></Form.Item><Form.Item name="productCode" label="Mã sản phẩm" rules={[{ validator: (_, value) => currentPriceType !== "PRODUCT" || value?.trim() ? Promise.resolve() : Promise.reject(new Error("Đơn giá theo sản phẩm cần mã sản phẩm.")) }]}><Input /></Form.Item><Form.Item name="operationCode" label="Mã công đoạn / nguồn gốc"><Input /></Form.Item></div><Alert type="info" showIcon message={priceTypes.find((type) => type.value === currentPriceType)?.note ?? "Chọn loại đơn giá để xem yêu cầu."} /></section> : <section className="configuration-subsection"><Title level={2}>Công thức</Title><div className="form-grid"><Form.Item name="componentId" label="Cấu phần lương gắn kết" rules={[{ required: true, message: "Chọn cấu phần lương." }]}><Select ref={preserveRequiredCombobox} loading={componentQuery.isLoading} showSearch optionFilterProp="label" options={componentQuery.data?.items.filter((component) => component.activeVersion?.active && componentScopes.has(component.orgUnitId)).map((component) => ({ value: component.id, label: `${component.code} — ${component.activeVersion?.name ?? component.orgUnitName}` }))} /></Form.Item><Form.Item name="roundingMode" label="Chế độ làm tròn" rules={[{ required: true, message: "Chọn chế độ làm tròn." }]}><Select ref={preserveRequiredCombobox} options={roundingOptions} /></Form.Item><Form.Item name="roundingScale" label="Số chữ số làm tròn" rules={[{ required: true, message: "Nhập số chữ số." }]}><InputNumber min={0} max={6} precision={0} className="full-width" /></Form.Item><div /></div><Form.Item name="expression" label="Biểu thức" rules={required} extra="Cho phép + − × ÷, ngoặc, so sánh, MIN/MAX, ABS, IF (nhánh lười) và ROUND(giá trị, chữ số). Ký hiệu biến chỉ gồm chữ hoa, số và _."><Input.TextArea rows={4} placeholder="IF(GIO_CONG &gt; 0, LUONG_GIO * GIO_CONG, 0)" /></Form.Item>{variableRows}</section>}
    </Form>
  </Drawer>;
}

function FormulaPreview({ context }: { context: PayrollConfigurationContext }) {
  const [form] = Form.useForm<{ orgUnitId?: string; asOf?: string; formulaCode?: string; values?: Record<string, string> }>();
  const [selection, setSelection] = useState<{ orgUnitId: string; asOf: string; formulaCode: string }>();
  const [previewContext, setPreviewContext] = useState<PreviewContext>();
  const [result, setResult] = useState<{ order: string[]; results: PreviewResult[] }>();
  const formulaQuery = useQuery({ queryKey: ["payroll-configuration", "preview-formulas", selection?.asOf], queryFn: () => payrollConfigurationApi.list({ kind: "FORMULA", asOf: selection!.asOf }), enabled: Boolean(selection?.orgUnitId && selection?.asOf) });
  const formulaOptions = useMemo(() => {
    const selected = new Map<string, { value: string; label: string; disabled: boolean }>();
    for (const scope of configurationScopes(context, selection?.orgUnitId)) for (const item of formulaQuery.data?.items ?? []) {
      if (item.orgUnitId !== scope || selected.has(item.code) || !item.versions.some(version => version.effectiveFrom <= selection!.asOf)) continue;
      selected.set(item.code, { value: item.code, label: item.code + " — " + (item.activeVersion?.name ?? "Không hiệu lực"), disabled: !item.activeVersion?.active });
    }
    return [...selected.values()];
  }, [context, formulaQuery.data, selection]);
  const contextQuery = useQuery({ queryKey: ["payroll-configuration", "preview-context", selection], queryFn: () => payrollConfigurationApi.previewContext(selection!.orgUnitId, selection!.asOf, selection!.formulaCode), enabled: Boolean(selection?.orgUnitId && selection?.asOf && selection?.formulaCode) });
  useEffect(() => { form.setFieldsValue({ asOf: context.asOf }); }, [context.asOf, form]);
  useEffect(() => { setPreviewContext(contextQuery.data); setResult(undefined); if (contextQuery.data) form.setFieldsValue({ values: {} }); }, [contextQuery.data, form]);
  const chooseContext = () => {
    const values = form.getFieldsValue();
    if (!values.orgUnitId || !values.asOf) return form.validateFields(["orgUnitId", "asOf"]);
    setSelection({ orgUnitId: values.orgUnitId, asOf: values.asOf, formulaCode: "" });
    form.setFieldsValue({ formulaCode: undefined, values: {} });
    setPreviewContext(undefined);
    setResult(undefined);
    previewMutation.reset();
  };
  const chooseFormula = (formulaCode: string) => {
    const values = form.getFieldsValue();
    if (!values.orgUnitId || !values.asOf) return;
    setSelection({ orgUnitId: values.orgUnitId, asOf: values.asOf, formulaCode });
    setResult(undefined);
  };
  const previewMutation = useMutation({ mutationFn: (values: { orgUnitId: string; asOf: string; formulaCode: string; values?: Record<string, string> }) => payrollConfigurationApi.preview({ orgUnitId: values.orgUnitId, asOf: values.asOf, formulaCode: values.formulaCode, inputs: (previewContext?.inputs ?? []).map((input) => ({ code: input.code, unit: input.unit, value: values.values?.[input.code] ?? "" })) }), onSuccess: (response) => setResult(response) });
  const submitPreview = async () => { try { const values = await form.validateFields(); if (!selection?.formulaCode || !previewContext) return; previewMutation.mutate({ orgUnitId: selection.orgUnitId, asOf: selection.asOf, formulaCode: selection.formulaCode, values: values.values }); } catch { /* Ant Form renders input errors. */ } };
  return <section className="panel preview-workspace"><div className="panel-heading"><div><Title level={2}>Chạy thử công thức đã lưu</Title><Paragraph type="secondary">Mô phỏng đọc dữ liệu cấu hình tại ngày chọn, không ghi kết quả lương.</Paragraph></div><Tag color="blue">Mô phỏng</Tag></div><div className="preview-controls"><Form name="formula-preview" form={form} layout="vertical" requiredMark="optional" disabled={previewMutation.isPending} onValuesChange={() => { setResult(undefined); previewMutation.reset(); }}><div className="preview-selection"><Form.Item name="orgUnitId" label="Đơn vị đích" rules={[{ required: true, message: "Chọn đơn vị đích." }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" options={context.units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} onChange={chooseContext} /></Form.Item><Form.Item name="asOf" label="Ngày áp dụng" rules={[{ required: true, message: "Chọn ngày áp dụng." }]}><Input type="date" onChange={chooseContext} /></Form.Item><Form.Item name="formulaCode" label="Công thức" rules={[{ required: true, message: "Chọn công thức." }]}><Select ref={preserveRequiredCombobox} loading={formulaQuery.isLoading} disabled={!selection?.orgUnitId} options={formulaOptions} onChange={chooseFormula} /></Form.Item></div>
      {formulaQuery.isError && <Alert type="error" showIcon message={errorMessage(formulaQuery.error)} />}
      {contextQuery.isError && <Alert type="error" showIcon message={errorMessage(contextQuery.error)} />}
      {contextQuery.isLoading && <Skeleton active paragraph={{ rows: 2 }} />}
      {previewContext && <><Alert type="info" showIcon message={`Thứ tự tính: ${previewContext.order.join(" → ") || "Công thức đã chọn"}. Nhập mọi dữ liệu mẫu bắt buộc; không có giá trị mặc định.`} /><div className="preview-inputs">{previewContext.inputs.map((input) => <Form.Item key={input.code} name={["values", input.code]} label={`${input.code} · ${input.unit}`} rules={[{ required: true, whitespace: true, message: `Nhập ${input.code}.` }]} extra={[input.min !== undefined ? `Từ ${input.min}` : "", input.max !== undefined ? `đến ${input.max}` : ""].filter(Boolean).join(" ")}><Input inputMode="decimal" placeholder="Nhập giá trị mẫu" /></Form.Item>)}</div><Button type="primary" onClick={submitPreview} loading={previewMutation.isPending}>Chạy mô phỏng</Button></>}
    </Form></div>{previewMutation.isError && <Alert type="error" showIcon message={errorMessage(previewMutation.error)} />}{result && <div className="preview-trace"><div><Text strong>Thứ tự kết quả</Text><div className="trace-order">{result.order.map((code) => <Tag key={code}>{code}</Tag>)}</div></div>{result.results.map((entry) => <section className="trace-result" key={entry.versionId}><Space wrap><Text strong>{entry.code} · {entry.name}</Text><Tag color="blue">{decimalLabel(entry.value)} {entry.unit}</Tag><Text type="secondary">Phiên bản {entry.versionId}</Text></Space><Text type="secondary">Giá trị thô: {entry.rawValue}; {roundingOptions.find((item) => item.value === entry.roundingMode)?.label}, {entry.roundingScale} chữ số</Text><code>{entry.expression}</code><div className="trace-variables">{entry.variables.map((variable) => <Tag key={`${variable.symbol}-${variable.reference}`}>{variable.symbol} ← {variable.source}:{variable.reference} = {variable.value} {variable.unit}{variable.versionId ? ` · ${variable.versionId}` : ""}</Tag>)}</div></section>)}</div>}</section>;
}

export function PayrollConfigurationWorkspace({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<PayrollConfigurationKind>("PRICE");
  const [filter, setFilter] = useState({ orgUnitId: undefined as string | undefined, asOf: undefined as string | undefined, search: "" });
  const [editor, setEditor] = useState<{ item?: PayrollConfiguration; kind: PayrollConfigurationKind }>();
  const [history, setHistory] = useState<PayrollConfiguration>();
  const contextQuery = useQuery({ queryKey: ["payroll-configuration-context"], queryFn: payrollConfigurationApi.context });
  const context = contextQuery.data;
  const listQuery = useQuery({ queryKey: ["payroll-configuration", kind, filter], queryFn: () => payrollConfigurationApi.list({ kind, ...filter }), enabled: Boolean(context) });
  useEffect(() => { if (context && !filter.asOf) setFilter((current) => ({ ...current, asOf: context.asOf })); }, [context, filter.asOf]);
  const saved = (code: string) => { setEditor(undefined); queryClient.invalidateQueries({ queryKey: ["payroll-configuration"] }); setFilter((current) => ({ ...current, search: code })); };
  const columns: ColumnsType<PayrollConfiguration> = [
    { title: "Mã / tên", key: "code", render: (_, item) => <><Text strong>{item.code}</Text><span className="table-subtext">{item.activeVersion?.name ?? "Chưa có phiên bản hiệu lực"}</span></> },
    { title: "Đơn vị quản lý", key: "unit", render: (_, item) => <>{item.orgUnitName}<span className="table-subtext">{item.orgUnitCode}</span></> },
    { title: kind === "PRICE" ? "Giá trị" : "Biểu thức", key: "value", width: 240, render: (_, item) => { const version = item.activeVersion; return !version ? "—" : "priceType" in version ? <span className="numeric">{decimalLabel(version.amount)} {version.unit}</span> : <code className="configuration-expression">{version.expression}</code>; } },
    { title: "Hiệu lực", key: "effective", render: (_, item) => item.activeVersion ? <>{windowText(item.activeVersion)}<span className="table-subtext">{item.activeVersion.unit}</span></> : <Tag>Không hiệu lực</Tag> },
    { title: "Trạng thái", key: "status", render: (_, item) => item.activeVersion ? <Space wrap>{statusTag(item.activeVersion)}<Tag color={item.activeVersion.active ? "success" : "default"}>{item.activeVersion.active ? "Áp dụng" : "Ngừng"}</Tag></Space> : "—" },
    { title: "Thao tác", key: "actions", align: "right", render: (_, item) => <Button type="text" icon={<HistoryOutlined />} onClick={(event) => { event.stopPropagation(); setHistory(item); }}>Lịch sử</Button> },
  ];
  if (contextQuery.isLoading) return <div className="content-loading"><Skeleton active /></div>;
  if (contextQuery.isError || !context) return <Alert type="error" showIcon message={errorMessage(contextQuery.error)} />;
  const canManage = user.roles.includes("KT") && user.permissions.includes("payroll.components.manage");
  return <div className="content-stack payroll-configuration-workspace"><div className="page-heading"><div><p className="eyebrow">CẤU HÌNH TIỀN LƯƠNG</p><Title level={1}>Đơn giá &amp; công thức</Title><Paragraph type="secondary">Quản lý đơn giá, công thức khai báo và mô phỏng có vết theo phiên bản hiệu lực.</Paragraph></div>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ kind })}>Tạo {kind === "PRICE" ? "đơn giá" : "công thức"}</Button>}</div><Tabs activeKey={kind} onChange={(value) => { setKind(value as PayrollConfigurationKind); setFilter((current) => ({ ...current, search: "" })); }} items={[{ key: "PRICE", label: "Đơn giá" }, { key: "FORMULA", label: "Công thức" }]} /><section className="panel configuration-filter-panel"><Input prefix={<SearchOutlined />} allowClear value={filter.search} placeholder="Tìm mã hoặc tên" onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value }))} /><Select ref={preserveRequiredCombobox} aria-label="Lọc đơn vị quản lý" allowClear showSearch optionFilterProp="label" value={filter.orgUnitId} placeholder="Tất cả đơn vị trong phạm vi" options={context.units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} onChange={(orgUnitId) => setFilter((current) => ({ ...current, orgUnitId }))} /><Input aria-label="Ngày xem hiệu lực" type="date" value={filter.asOf} onChange={(event) => setFilter((current) => ({ ...current, asOf: event.target.value || undefined }))} /><Button icon={<ReloadOutlined />} onClick={() => listQuery.refetch()} loading={listQuery.isFetching}>Tải lại</Button></section>{listQuery.isError ? <Alert type="error" showIcon message={errorMessage(listQuery.error)} /> : <section className="panel table-panel"><Table rowKey="id" components={tableComponents} columns={columns} dataSource={listQuery.data?.items ?? []} loading={listQuery.isLoading} pagination={false} scroll={{ x: 850 }} locale={{ emptyText: <Empty description="Không có dữ liệu trong phạm vi và ngày đã chọn." /> }} onRow={(item) => ({ className: "clickable-row", onClick: () => setHistory(item) })} /><div className="table-footer"><Text type="secondary">Ngày xem hiệu lực: <strong>{listQuery.data?.asOf ? day(listQuery.data.asOf) : day(filter.asOf ?? context.asOf)}</strong></Text><Text type="secondary">{listQuery.data?.items.length ?? 0} mục</Text></div></section>}<FormulaPreview context={context} />{history && <ConfigurationHistory id={history.id} asOf={filter.asOf ?? context.asOf} onClose={() => setHistory(undefined)} onSuccessor={(item) => { setHistory(undefined); setEditor({ item, kind: item.kind }); }} />}{editor && <ConfigurationEditor item={editor.item} kind={editor.kind} context={context} onClose={() => setEditor(undefined)} onSaved={saved} />}</div>;
}
