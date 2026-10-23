import { DownloadOutlined, FileAddOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Descriptions, Divider, Drawer, Empty, Form, Grid, Input, Modal, Pagination, Select, Skeleton, Space, Table, Tag, Tooltip, Typography, Upload } from "antd";
import type { FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { ApiError, errorMessage } from "../api/client";
import { employeePayPlansApi } from "../api/employee-pay-plans";
import { attendanceApi } from "../api/attendance";
import type { AttendancePeriod } from "../api/attendance";
import { payrollConfigurationApi } from "../api/payroll-configuration";
import { payrollInputsApi } from "../api/payroll-inputs";
import type { PayrollBatch, PayrollBatchFilter, PayrollBatchInput, PayrollBatchLine, PayrollBatchSummary, PayrollCalculationMode, PayrollInputContext, PayrollInputLine, PayrollInputProvenance, PayrollInputStatus, PayrollInputType, PayrollPeriod, PayrollTeamAllocation, PayrollValueState } from "../api/payroll-inputs";
import type { AuthUser } from "../api/hrtp";

const { Title, Paragraph, Text } = Typography;
const required = [{ required: true, whitespace: true, message: "Nhập thông tin bắt buộc." }];
const inputTypes: Array<{ value: PayrollInputType; label: string }> = [
  { value: "TIME", label: "Thời gian" }, { value: "PRODUCT", label: "Sản phẩm" }, { value: "PIECEWORK", label: "Khoán" }, { value: "COMMISSION", label: "Hoa hồng" }, { value: "THREE_P", label: "Lương 3P" }, { value: "ALLOWANCE", label: "Phụ cấp" }, { value: "BONUS", label: "Thưởng" }, { value: "DEDUCTION", label: "Khấu trừ" }, { value: "EMPLOYER_COST", label: "Chi phí doanh nghiệp" }, { value: "ADJUSTMENT", label: "Điều chỉnh" },
];
const valueStates: Array<{ value: PayrollValueState; label: string; note: string }> = [
  { value: "PRESENT", label: "Có dữ liệu", note: "Nguồn có giá trị, công thức hoặc số tiền được khai báo rõ." },
  { value: "MISSING", label: "Thiếu dữ liệu", note: "Giữ lô nháp; không thể kiểm tra hoặc xác nhận." },
  { value: "CONFIRMED_ZERO", label: "Xác nhận bằng 0", note: "0 là một xác nhận nguồn riêng, không phải dữ liệu thiếu." },
  { value: "NOT_APPLICABLE", label: "Không áp dụng", note: "Chỉ dùng khi quy tắc kế hoạch cho phép không áp dụng." },
];
const statusLabels: Record<PayrollInputStatus, string> = { DRAFT: "Nháp", VALIDATED: "Đã kiểm tra", CONFIRMED: "Đã xác nhận", RETURNED: "Đã trả lại", SUPERSEDED: "Đã được thay thế" };
const statusColors: Record<PayrollInputStatus, string> = { DRAFT: "default", VALIDATED: "blue", CONFIRMED: "green", RETURNED: "orange", SUPERSEDED: "purple" };
const provenanceLabels: Record<PayrollInputProvenance, string> = { SIMULATION: "Mô phỏng", BUSINESS_CONFIRMED: "Đã xác nhận nghiệp vụ" };
const actionLabels: Record<string, string> = { CREATE: "Tiếp nhận", VALIDATE: "Kiểm tra", CONFIRM: "Xác nhận", RETURN: "Trả lại", SUPERSEDE: "Thay thế", ATTACH_EVIDENCE: "Bổ sung chứng từ" };
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

function day(value?: string | null): string { return value ? value.split("-").reverse().join("/") : "Chưa khai báo"; }
function time(value: string): string { return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)); }
function statusTag(status: PayrollInputStatus) { return <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>; }
function valueStateLabel(value?: PayrollValueState) { return valueStates.find((item) => item.value === value)?.label ?? "Chưa chọn"; }
function inputTypeLabel(value?: PayrollInputType) { return inputTypes.find((item) => item.value === value)?.label ?? value ?? "Chưa chọn"; }
function decimal(value?: string) {
  if (!value) return "Chưa có dữ liệu";
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  return `${negative ? "-" : ""}${new Intl.NumberFormat("vi-VN").format(BigInt(whole))}${fraction ? `,${fraction}` : ""}`;
}
function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} tabIndex={0} aria-label="Bảng lô đầu vào lương; dùng phím mũi tên để cuộn" />; }
const tableComponents = { body: { wrapper: TableBody } };
function preserveRequiredCombobox(select: { nativeElement?: HTMLElement | null } | null) { select?.nativeElement?.removeAttribute("aria-required"); }
function download(blob: Blob, name: string) { const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.click(); URL.revokeObjectURL(href); }
function prune<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "" && item !== null)) as T; }
function exactDecimal(_: unknown, value?: string) { return !value || decimalPattern.test(value) ? Promise.resolve() : Promise.reject(new Error("Nhập decimal dạng chuỗi, tối đa 6 chữ số thập phân; không dùng số mũ.")); }
function exactUuid(_: unknown, value?: string) { return !value || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim()) ? Promise.resolve() : Promise.reject(new Error("Nhập UUID của dòng nguồn gốc.")); }


interface BatchFormValues extends Omit<PayrollBatchInput, "lines" | "teamAllocations"> { lines: Array<PayrollInputLine & { employeeCode?: string; employeeName?: string }>; teamAllocations?: PayrollTeamAllocation[] }

function cleanLine(line: PayrollInputLine): PayrollInputLine {
  const base = { sourceLineId: line.sourceLineId.trim(), employeeId: line.employeeId, componentId: line.componentId, inputType: line.inputType, workFrom: line.workFrom, workTo: line.workTo, valueState: line.valueState, calculationMode: line.calculationMode };
  if (line.valueState === "MISSING" || line.valueState === "NOT_APPLICABLE") return prune({ ...base, supersedesLineId: line.supersedesLineId?.trim() });
  if (line.calculationMode === "AMOUNT") return prune({ ...base, amount: line.amount?.trim(), unit: line.unit?.trim(), amountBasis: line.amountBasis?.trim(), businessReference: line.businessReference?.trim(), adjustmentOfLineId: line.adjustmentOfLineId?.trim(), teamAllocationKey: line.teamAllocationKey?.trim(), allocatedAmount: line.allocatedAmount?.trim(), supersedesLineId: line.supersedesLineId?.trim() });
  return prune({ ...base, formulaCode: line.formulaCode, inputs: (line.inputs ?? []).map((input) => ({ code: input.code.trim(), unit: input.unit.trim(), value: input.value.trim() })), amountBasis: line.inputType === "ADJUSTMENT" ? line.amountBasis?.trim() : undefined, businessReference: line.businessReference?.trim(), adjustmentOfLineId: line.adjustmentOfLineId?.trim(), teamAllocationKey: line.teamAllocationKey?.trim(), allocatedAmount: line.allocatedAmount?.trim(), supersedesLineId: line.supersedesLineId?.trim() });
}
function cleanBatch(values: BatchFormValues): PayrollBatchInput {
  return prune({
    payrollPeriodId: values.payrollPeriodId, sourceSystem: values.sourceSystem.trim(), sourceDocumentNo: values.sourceDocumentNo.trim(), sourceVersion: values.sourceVersion.trim(), mappingVersion: values.mappingVersion.trim(), provenance: values.provenance, preparedBy: values.preparedBy.trim(), sourceApprovedBy: values.sourceApprovedBy?.trim(), sourceApprovedAt: values.sourceApprovedAt, sourceApprovalReference: values.sourceApprovalReference?.trim(), reason: values.reason.trim(), supersedesBatchId: values.supersedesBatchId, attendancePeriodIds: values.attendancePeriodIds?.filter(Boolean), lines: values.lines.map(cleanLine), teamAllocations: values.teamAllocations?.map((allocation) => ({ key: allocation.key.trim(), teamOrgUnitId: allocation.teamOrgUnitId, acceptedAmount: allocation.acceptedAmount.trim(), reference: allocation.reference.trim() })),
  });
}

function PayrollPeriodEditor({ context, onClose, onSaved }: { context: PayrollInputContext; onClose: () => void; onSaved: (period: PayrollPeriod) => void }) {
  const [form] = Form.useForm<{ code: string; siteOrgUnitId: string; dateFrom: string; dateTo: string; expectedPaymentDate?: string }>();
  const mutation = useMutation({ mutationFn: (values: { code: string; siteOrgUnitId: string; dateFrom: string; dateTo: string; expectedPaymentDate?: string }) => payrollInputsApi.createPeriod(prune(values)), onSuccess: ({ period }) => onSaved(period) });
  return <Modal open title="Tạo kỳ nhận đầu vào lương" okText="Tạo kỳ" cancelText="Hủy" confirmLoading={mutation.isPending} onCancel={() => !mutation.isPending && onClose()} onOk={() => form.submit()} destroyOnClose>
    <Form form={form} layout="vertical" requiredMark="optional" onFinish={(values) => mutation.mutate(values)} disabled={mutation.isPending}>
      <Alert type="info" showIcon message="Đây là kỳ nhận đầu vào lương" description="Kỳ này độc lập với kỳ công. Trạng thái khóa kỳ lương do quy trình tính lương tương lai điều khiển; không có thao tác khóa ở màn hình này." />
      <div className="payroll-input-form-grid">
        <Form.Item name="code" label="Mã kỳ" rules={required}><Input autoComplete="off" placeholder="VD: INPUT-2026-10-BN" /></Form.Item>
        <Form.Item name="siteOrgUnitId" label="Cơ sở" rules={[{ required: true, message: "Chọn cơ sở." }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" options={context.managementUnits.filter((unit) => unit.type === "SITE").map((unit) => ({ value: unit.id, label: `${unit.code} · ${unit.name}` }))} /></Form.Item>
        <Form.Item name="dateFrom" label="Từ ngày" rules={[{ required: true, message: "Chọn ngày bắt đầu." }]}><Input type="date" /></Form.Item>
        <Form.Item name="dateTo" label="Đến ngày" dependencies={["dateFrom"]} rules={[{ required: true, message: "Chọn ngày kết thúc." }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value >= getFieldValue("dateFrom") ? Promise.resolve() : Promise.reject(new Error("Ngày kết thúc không được trước ngày bắt đầu.")) })]}><Input type="date" /></Form.Item>
        <Form.Item name="expectedPaymentDate" label="Ngày chi trả dự kiến" className="form-span-2"><Input type="date" /></Form.Item>
      </div>
      {mutation.isError && <Alert type="error" showIcon message="Không tạo được kỳ" description={errorMessage(mutation.error)} />}
    </Form>
  </Modal>;
}

function EmployeePicker({ field, form }: { field: number; form: FormInstance<BatchFormValues> }) {
  const employeeId = Form.useWatch(["lines", field, "employeeId"], form);
  const employeeCode = Form.useWatch(["lines", field, "employeeCode"], form);
  const employeeName = Form.useWatch(["lines", field, "employeeName"], form);
  const workFrom = Form.useWatch(["lines", field, "workFrom"], form);
  const [search, setSearch] = useState("");
  const employees = useQuery({ queryKey: ["payroll-input-employees", workFrom, search], queryFn: () => employeePayPlansApi.employees({ asOf: workFrom, search: search || undefined, page: 1, pageSize: 40 }), enabled: Boolean(workFrom) });
  const selectedEmployee = useQuery({ queryKey: ["payroll-input-selected-employee", employeeId, employeeCode, workFrom], queryFn: async () => (await employeePayPlansApi.employees({ asOf: workFrom, search: employeeCode, page: 1, pageSize: 20 })).items.find((item) => item.id === employeeId), enabled: Boolean(employeeId && employeeCode && workFrom) });
  const options = new Map((employees.data?.items ?? []).map((employee) => [employee.id, employee]));
  if (selectedEmployee.data) options.set(selectedEmployee.data.id, selectedEmployee.data);
  if (employeeId && employeeCode && !options.has(employeeId)) options.set(employeeId, { id: employeeId, code: employeeCode, fullName: employeeName ?? "Nhân viên đã chọn", orgUnitId: "", orgUnitCode: "", orgUnitName: "" });
  const selected = options.get(employeeId);
  const clearLineBinding = () => {
    form.setFieldValue(["lines", field, "componentId"], undefined);
    form.setFieldValue(["lines", field, "formulaCode"], undefined);
    form.setFieldValue(["lines", field, "inputs"], undefined);
    form.setFieldValue(["lines", field, "amount"], undefined);
    form.setFieldValue(["lines", field, "unit"], undefined);
    form.setFieldValue(["lines", field, "amountBasis"], undefined);
  };
  return <Form.Item name={[field, "employeeId"]} label="Nhân viên" rules={[{ required: true, message: "Chọn nhân viên." }]} extra={!workFrom ? "Chọn khoảng ngày trước để tìm theo kế hoạch hiệu lực." : selected ? `${selected.code} · ${selected.orgUnitName}` : "Đang nạp nhân viên đã chọn theo ngày bắt đầu."}><Select ref={preserveRequiredCombobox} showSearch filterOption={false} onSearch={setSearch} onChange={(id) => {
    const employee = options.get(id);
    form.setFieldValue(["lines", field, "employeeCode"], employee?.code);
    form.setFieldValue(["lines", field, "employeeName"], employee?.fullName);
    clearLineBinding();
  }} optionFilterProp="label" loading={employees.isFetching || selectedEmployee.isFetching} options={[...options.values()].map((employee) => ({ value: employee.id, label: `${employee.code} · ${employee.fullName} · ${employee.orgUnitName}` }))} placeholder="Tìm mã hoặc tên nhân viên" /></Form.Item>;
}

function PayrollInputLineEditor({ field, index, form, remove, allowedInputTypes, configurationOrgUnitId, teamAllocationKeys }: { field: { key: number; name: number }; index: number; form: FormInstance<BatchFormValues>; remove: (index: number) => void; allowedInputTypes: PayrollInputType[]; configurationOrgUnitId?: string; teamAllocationKeys: string[] }) {
  const employeeId = Form.useWatch(["lines", field.name, "employeeId"], form);
  const workFrom = Form.useWatch(["lines", field.name, "workFrom"], form);
  const componentId = Form.useWatch(["lines", field.name, "componentId"], form);
  const calculationMode = Form.useWatch(["lines", field.name, "calculationMode"], form) as PayrollCalculationMode | undefined;
  const valueState = Form.useWatch(["lines", field.name, "valueState"], form) as PayrollValueState | undefined;
  const inputType = Form.useWatch(["lines", field.name, "inputType"], form) as PayrollInputType | undefined;
  const formulaCode = Form.useWatch(["lines", field.name, "formulaCode"], form);
  const teamAllocationKey = Form.useWatch(["lines", field.name, "teamAllocationKey"], form) as string | undefined;
  const isReplacementLine = Boolean(Form.useWatch(["lines", field.name, "supersedesLineId"], form));
  const catalogue = useQuery({ queryKey: ["payroll-input-catalogue", employeeId, workFrom], queryFn: () => employeePayPlansApi.catalogue(employeeId!, workFrom!), enabled: Boolean(employeeId && workFrom) });
  const formulaOptions = (catalogue.data?.formulae ?? []).filter((formula) => !componentId || formula.componentId === componentId).map((formula) => ({ value: formula.code, label: `${formula.code} · ${formula.name}` }));
  const variables = useQuery({ queryKey: ["payroll-input-variables", configurationOrgUnitId, workFrom, formulaCode], queryFn: () => payrollConfigurationApi.previewContext(configurationOrgUnitId!, workFrom!, formulaCode!), enabled: calculationMode === "FORMULA" && Boolean(configurationOrgUnitId && workFrom && formulaCode) });
  const requiresBusinessReference = ["PRODUCT", "PIECEWORK", "COMMISSION", "BONUS", "THREE_P"].includes(inputType ?? "");
  const inactiveValue = valueState === "MISSING" || valueState === "NOT_APPLICABLE";
  const clearModeData = () => {
    form.setFieldValue(["lines", field.name, "formulaCode"], undefined);
    form.setFieldValue(["lines", field.name, "inputs"], undefined);
    form.setFieldValue(["lines", field.name, "amount"], undefined);
    form.setFieldValue(["lines", field.name, "unit"], undefined);
    form.setFieldValue(["lines", field.name, "amountBasis"], undefined);
  };
  const clearLineBinding = () => {
    form.setFieldValue(["lines", field.name, "componentId"], undefined);
    clearModeData();
  };
  const selectFormula = (code: string) => { form.setFieldValue(["lines", field.name, "formulaCode"], code); form.setFieldValue(["lines", field.name, "inputs"], undefined); };
  const selectMode = (mode: PayrollCalculationMode) => { form.setFieldValue(["lines", field.name, "calculationMode"], mode); if (mode === "AMOUNT") { form.setFieldValue(["lines", field.name, "formulaCode"], undefined); form.setFieldValue(["lines", field.name, "inputs"], undefined); } else { form.setFieldValue(["lines", field.name, "amount"], undefined); form.setFieldValue(["lines", field.name, "unit"], undefined); form.setFieldValue(["lines", field.name, "amountBasis"], undefined); } };
  const selectValueState = (state: PayrollValueState) => { form.setFieldValue(["lines", field.name, "valueState"], state); if (state === "MISSING" || state === "NOT_APPLICABLE") clearModeData(); };
  const supportsTeamAllocation = inputType === "PRODUCT" || inputType === "PIECEWORK";
  useEffect(() => {
    if (!variables.data) return;
    const current = (form.getFieldValue(["lines", field.name, "inputs"]) ?? []) as NonNullable<PayrollInputLine["inputs"]>;
    form.setFieldValue(["lines", field.name, "inputs"], variables.data.inputs.map((variable) => ({
      code: variable.code,
      unit: variable.unit,
      value: current.find((input) => input.code === variable.code)?.value ?? "",
    })));
  }, [field.name, form, variables.data]);
  return <section className="payroll-input-line" aria-label={`Dòng nguồn ${index + 1}`}>
    <div className="payroll-input-line-heading"><strong>Dòng nguồn {index + 1}</strong><Tooltip title={isReplacementLine ? "Dòng của phiên bản thay thế phải giữ lại; dùng trạng thái Không áp dụng hoặc Xác nhận bằng 0 khi nguồn không còn hiệu lực." : "Bỏ dòng này"}><Button danger type="text" disabled={isReplacementLine} onClick={() => remove(field.name)} aria-label={`Bỏ dòng nguồn ${index + 1}`}>Bỏ dòng</Button></Tooltip></div>
    <div className="payroll-input-form-grid">
      <Form.Item name={[field.name, "sourceLineId"]} label="Mã dòng nguồn" rules={required} extra={isReplacementLine ? "Mã dòng gốc được giữ ổn định trong phiên bản thay thế." : "Mã ổn định từ chứng từ nguồn, không dùng số thứ tự CSV."}><Input disabled={isReplacementLine} /></Form.Item>
      <Form.Item name={[field.name, "inputType"]} label="Loại đầu vào" rules={[{ required: true, message: "Chọn loại đầu vào." }]}><Select ref={preserveRequiredCombobox} options={inputTypes.filter((item) => allowedInputTypes.includes(item.value))} onChange={(nextType: PayrollInputType) => { if (nextType !== "PRODUCT" && nextType !== "PIECEWORK") { form.setFieldValue(["lines", field.name, "teamAllocationKey"], undefined); form.setFieldValue(["lines", field.name, "allocatedAmount"], undefined); } }} /></Form.Item>
      <Form.Item name={[field.name, "workFrom"]} label="Từ ngày làm việc" rules={[{ required: true, message: "Chọn ngày bắt đầu." }]}><Input type="date" onChange={clearLineBinding} /></Form.Item>
      <Form.Item name={[field.name, "workTo"]} label="Đến ngày làm việc" dependencies={[["lines", field.name, "workFrom"]]} rules={[{ required: true, message: "Chọn ngày kết thúc." }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value >= getFieldValue(["lines", field.name, "workFrom"]) ? Promise.resolve() : Promise.reject(new Error("Ngày kết thúc không được trước ngày bắt đầu.")) })]}><Input type="date" /></Form.Item>
      <EmployeePicker field={field.name} form={form} />
      <Form.Item name={[field.name, "componentId"]} label="Cấu phần lương" rules={[{ required: true, message: "Chọn cấu phần." }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" loading={catalogue.isFetching} options={(catalogue.data?.components ?? []).map((component) => ({ value: component.id, label: `${component.code} · ${component.name}` }))} placeholder="Chọn sau khi chọn nhân viên" onChange={clearModeData} /></Form.Item>
      <Form.Item name={[field.name, "valueState"]} label="Trạng thái giá trị" rules={[{ required: true, message: "Chọn trạng thái giá trị." }]} extra={valueStates.find((item) => item.value === valueState)?.note}><Select ref={preserveRequiredCombobox} options={valueStates.map(({ value, label }) => ({ value, label }))} onChange={selectValueState} /></Form.Item>
      <Form.Item name={[field.name, "calculationMode"]} label="Cơ sở nhận dữ liệu" rules={[{ required: true, message: "Chọn cơ sở nhận dữ liệu." }]}><Select ref={preserveRequiredCombobox} disabled={inactiveValue} options={[{ value: "FORMULA", label: "Theo công thức" }, { value: "AMOUNT", label: "Số tiền trực tiếp" }]} onChange={selectMode} /></Form.Item>
    </div>
    {!inactiveValue && calculationMode === "FORMULA" && <div className="payroll-input-form-grid payroll-input-mode-fields">
      <Form.Item name={[field.name, "formulaCode"]} label="Công thức" rules={[{ required: true, message: "Chọn công thức." }, { validator: () => variables.isFetching ? Promise.reject(new Error("Đợi tải biến, đơn vị và giới hạn công thức.")) : variables.isError ? Promise.reject(new Error("Không tải được biến công thức; không thể gửi dòng công thức.")) : variables.data ? Promise.resolve() : Promise.reject(new Error("Chọn công thức để nạp biến.")) }]}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" options={formulaOptions} loading={catalogue.isFetching} onChange={selectFormula} /></Form.Item>
      <div className="payroll-input-context-note">{variables.isLoading ? "Đang tải biến và đơn vị theo công thức…" : variables.isError ? "Không tải được biến công thức. Kiểm tra ngày, nhân viên, kỳ nhận và cấu phần." : variables.data ? `Biến tại ${day(workFrom)}: ${variables.data.order.join(" → ") || formulaCode}. Máy chủ kiểm tra toàn bộ khoảng ngày; hãy tách dòng nếu có thay đổi hiệu lực.` : "Chọn công thức để nạp đúng biến, đơn vị và giới hạn."}</div>
      {variables.data?.inputs.map((variable, variableIndex) => <Form.Item key={variable.code} name={[field.name, "inputs", variableIndex, "value"]} label={`${variable.code} · ${variable.unit}`} rules={[{ required: true, message: `Nhập ${variable.code}.` }, { validator: exactDecimal }]} extra={[variable.min !== undefined ? `Từ ${variable.min}` : "", variable.max !== undefined ? `Đến ${variable.max}` : ""].filter(Boolean).join(" · ")}><Input inputMode="decimal" placeholder="Decimal, không số mũ" /></Form.Item>)}
    </div>}
    {!inactiveValue && calculationMode === "AMOUNT" && <div className="payroll-input-form-grid payroll-input-mode-fields">
      <Form.Item name={[field.name, "amount"]} label="Số tiền" rules={[{ required: true, message: "Nhập số tiền." }, { validator: exactDecimal }, ({ getFieldValue }) => ({ validator: (_, value) => value?.startsWith("-") && getFieldValue(["lines", field.name, "inputType"]) !== "ADJUSTMENT" ? Promise.reject(new Error("Số tiền âm chỉ dùng cho dòng điều chỉnh.")) : Promise.resolve() }), ({ getFieldValue }) => ({ validator: (_, value) => { const isZero = /^-?0(?:\.0+)?$/.test(value?.trim() ?? ""); const state = getFieldValue(["lines", field.name, "valueState"]); return isZero && state !== "CONFIRMED_ZERO" ? Promise.reject(new Error("Số tiền 0 phải dùng trạng thái Xác nhận bằng 0.")) : state === "CONFIRMED_ZERO" && !isZero ? Promise.reject(new Error("Trạng thái Xác nhận bằng 0 cần số tiền 0.")) : Promise.resolve(); } })]}><Input inputMode="decimal" placeholder="Ví dụ: 1250000.50" /></Form.Item>
      <Form.Item name={[field.name, "unit"]} label="Đơn vị" rules={[{ required: true, message: "Đơn vị trực tiếp phải là VND." }, { validator: (_, value) => value === "VND" ? Promise.resolve() : Promise.reject(new Error("Số tiền trực tiếp phải dùng đơn vị VND.")) }]}><Input placeholder="VND" /></Form.Item>
      <Form.Item name={[field.name, "amountBasis"]} label="Căn cứ số tiền" rules={required} extra="Nêu căn cứ chứng từ đã được phê chuẩn, không dùng để thay thế công thức."><Input /></Form.Item>
    </div>}
    <div className="payroll-input-form-grid payroll-input-optional-fields">
      {!inactiveValue && inputType === "ADJUSTMENT" && calculationMode === "FORMULA" && <Form.Item name={[field.name, "amountBasis"]} label="Căn cứ điều chỉnh" rules={required}><Input /></Form.Item>}
      <Form.Item name={[field.name, "businessReference"]} label="Tham chiếu nghiệp vụ" rules={[{ validator: (_, value) => requiresBusinessReference && !value?.trim() ? Promise.reject(new Error("Loại nguồn này cần tham chiếu nghiệp vụ.")) : Promise.resolve() }]}><Input placeholder="Sản phẩm, công đoạn, mốc, quyết định…" /></Form.Item>
      <Form.Item name={[field.name, "adjustmentOfLineId"]} label="UUID dòng điều chỉnh gốc" rules={[{ validator: (_, value) => inputType === "ADJUSTMENT" && !value?.trim() ? Promise.reject(new Error("Điều chỉnh cần UUID dòng nguồn gốc đã xác nhận.")) : Promise.resolve() }, { validator: exactUuid }]} extra="Phải là ID dòng nguồn đã xác nhận hoặc đã được thay thế cùng nhân viên/cấu phần."><Input placeholder="UUID dòng nguồn gốc" /></Form.Item>
      <Form.Item name={[field.name, "teamAllocationKey"]} label="Nhóm phân bổ tổ" rules={[{ validator: (_, value) => !value || supportsTeamAllocation ? Promise.resolve() : Promise.reject(new Error("Chỉ nguồn sản phẩm hoặc khoán được phân bổ theo tổ.")) }, { validator: (_, value) => !value || teamAllocationKeys.includes(value) ? Promise.resolve() : Promise.reject(new Error("Chọn nhóm phân bổ tổ đã khai báo bên dưới.")) }, { validator: (_, value) => value || !form.getFieldValue(["lines", field.name, "allocatedAmount"]) ? Promise.resolve() : Promise.reject(new Error("Chọn nhóm phân bổ cho số tiền đã phân bổ.")) }]}><Select ref={preserveRequiredCombobox} allowClear disabled={!supportsTeamAllocation} options={teamAllocationKeys.map((key) => ({ value: key, label: key }))} placeholder="Chọn nhóm đã khai báo bên dưới" /></Form.Item>
      <Form.Item name={[field.name, "allocatedAmount"]} label="Tiền phân bổ cho người" rules={[{ validator: exactDecimal }, { validator: (_, value) => !teamAllocationKey?.trim() || value?.trim() ? Promise.resolve() : Promise.reject(new Error("Nhập tiền phân bổ cho người khi dùng phân bổ tổ.")) }]} extra="VND decimal; tổng mọi thành viên phải khớp tổng nhóm."><Input inputMode="decimal" disabled={!supportsTeamAllocation} placeholder="VND decimal" /></Form.Item>
      <Form.Item name={[field.name, "supersedesLineId"]} label="UUID dòng nguồn được thay thế" rules={[{ validator: exactUuid }]} extra={isReplacementLine ? "Liên kết với dòng gốc được giữ cố định." : undefined}><Input disabled={isReplacementLine} /></Form.Item>
    </div>
  </section>;
}

function BatchEditor({ context, periods, source, importFile, onClose, onSaved }: { context: PayrollInputContext; periods: PayrollPeriod[]; source?: PayrollBatch; importFile?: File; onClose: () => void; onSaved: (batch: PayrollBatch, duplicate: boolean) => void }) {
  const { modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<BatchFormValues>();
  const [conflicted, setConflicted] = useState(false);
  const defaultPeriod = periods.find((period) => period.status === "OPEN")?.id;
  const selectedPayrollPeriodId = Form.useWatch("payrollPeriodId", form);
  const selectedPeriod = periods.find((period) => period.id === selectedPayrollPeriodId);
  const teamAllocationKeys = (Form.useWatch("teamAllocations", form) ?? []).map((allocation) => allocation?.key?.trim()).filter((key): key is string => Boolean(key));
  const attendance = useQuery({ queryKey: ["attendance-context", "payroll-input-references"], queryFn: attendanceApi.context });
  const create = useMutation({
    mutationFn: (values: BatchFormValues) => importFile ? payrollInputsApi.importCsv(importFile, (() => { const { lines: _lines, ...metadata } = cleanBatch({ ...values, lines: [] }); return metadata; })()) : payrollInputsApi.create(cleanBatch(values)),
    onSuccess: ({ item, duplicate }) => onSaved(item, duplicate),
    onError: (error) => setConflicted(error instanceof ApiError && error.status === 409),
  });
  useEffect(() => {
    if (source) {
      form.setFieldsValue({ payrollPeriodId: source.payrollPeriod.id, sourceSystem: source.sourceSystem, sourceDocumentNo: source.sourceDocumentNo, sourceVersion: undefined, mappingVersion: source.mappingVersion, provenance: source.provenance, preparedBy: source.preparedBy, sourceApprovedBy: undefined, sourceApprovedAt: undefined, sourceApprovalReference: undefined, reason: source.reason, supersedesBatchId: source.id, attendancePeriodIds: source.attendancePeriodIds, teamAllocations: source.teamAllocations, lines: source.lines.map((line) => ({ sourceLineId: line.sourceLineId, employeeId: line.employeeId, employeeCode: line.employeeCode, employeeName: line.employeeName, componentId: line.componentId, inputType: line.inputType, workFrom: line.workFrom, workTo: line.workTo, valueState: line.valueState, calculationMode: line.calculationMode, formulaCode: line.formulaCode, inputs: line.inputs, amount: line.amount, unit: line.unit, amountBasis: line.amountBasis, businessReference: line.businessReference, adjustmentOfLineId: line.adjustmentOfLineId, teamAllocationKey: line.teamAllocationKey, allocatedAmount: line.allocatedAmount, supersedesLineId: line.id })) });
    } else form.setFieldsValue({ payrollPeriodId: defaultPeriod, lines: [] });
  }, [defaultPeriod, form, importFile, source]);
  const requestClose = () => {
    if (!form.isFieldsTouched()) return onClose();
    modal.confirm({ title: "Đóng biểu mẫu?", content: "Các thay đổi chưa lưu sẽ bị bỏ.", okText: "Bỏ thay đổi", cancelText: "Tiếp tục chỉnh sửa", okButtonProps: { danger: true }, onOk: onClose });
  };
  const submit = async () => { try { const values = await form.validateFields(); create.mutate(values); } catch { /* Ant Form renders field errors. */ } };
  const uploadName = importFile?.name;
  return <Drawer open title={importFile ? "Nhập CSV đầu vào lương" : source ? `Lập phiên bản thay thế · ${source.code}` : "Nhận đầu vào lương"} width={screens.lg ? 1060 : "100%"} onClose={requestClose} maskClosable={!create.isPending} className="payroll-input-editor" footer={<Space wrap><Button onClick={requestClose} disabled={create.isPending}>Hủy</Button><Button type="primary" icon={<FileAddOutlined />} loading={create.isPending} disabled={conflicted} onClick={submit}>{importFile ? "Nhập CSV" : source ? "Tạo phiên bản thay thế" : "Nhận lô đầu vào"}</Button></Space>}>
    <Space direction="vertical" size={16} className="full-width">
      <Alert type="info" showIcon message={source ? "Phiên bản thay thế không sửa lô đã nhận" : "Nhận nguồn đầu vào, không tính lương"} description={source ? "Giữ mã dòng ổn định, khai báo phiên bản nguồn mới và xác nhận các dòng không còn áp dụng bằng trạng thái rõ ràng. Lô cũ chỉ được thay thế khi lô mới được xác nhận." : "Giá trị được lưu theo nguồn đã khai báo. Xác nhận nguồn là quy trình riêng, không phải phê duyệt hay khóa kỳ lương."} />
      {importFile && <Alert type="info" showIcon message={`Tệp CSV: ${uploadName}`} description="Nhập metadata bằng biểu mẫu này; hệ thống đọc và kiểm tra từng dòng CSV theo mã nhân viên/cấu phần được phép." />}
      {conflicted && <Alert type="warning" showIcon message="Nguồn đã trùng hoặc dữ liệu đã thay đổi" description="Biểu mẫu vẫn được giữ. Không có dữ liệu nào bị ghi đè; hãy kiểm tra mã nguồn, phiên bản và tải lại danh sách trước khi gửi lại." action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setConflicted(false)}>Tiếp tục kiểm tra</Button>} />}
      {create.isError && !conflicted && <Alert type="error" showIcon message="Không nhận được lô đầu vào" description={errorMessage(create.error)} />}
      <Form form={form} layout="vertical" requiredMark="optional" disabled={create.isPending}>
        <Title level={3}>Nguồn và phê chuẩn</Title>
        <div className="payroll-input-form-grid">
          <Form.Item name="payrollPeriodId" label="Kỳ nhận đầu vào lương" rules={[{ required: true, message: "Chọn kỳ nhận đầu vào." }]}><Select ref={preserveRequiredCombobox} options={periods.map((period) => ({ value: period.id, disabled: period.status === "LOCKED", label: `${period.code} · ${period.siteName} · ${day(period.dateFrom)}–${day(period.dateTo)} · ${period.status === "OPEN" ? "Đang mở" : "Đã khóa"}` }))} /></Form.Item>
          <Form.Item name="provenance" label="Nguồn xác nhận" rules={[{ required: true, message: "Chọn nguồn xác nhận." }]}><Select ref={preserveRequiredCombobox} options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }]} /></Form.Item>
          <Form.Item name="sourceSystem" label="Hệ thống nguồn" rules={required}><Input disabled={Boolean(source)} placeholder="VD: ERP, MES, MANUAL" /></Form.Item>
          <Form.Item name="sourceDocumentNo" label="Số chứng từ nguồn" rules={required}><Input disabled={Boolean(source)} /></Form.Item>
          <Form.Item name="sourceVersion" label="Phiên bản nguồn" rules={[...required, ({ getFieldValue }) => ({ validator: (_, value) => !source || value?.trim() !== source.sourceVersion ? Promise.resolve() : Promise.reject(new Error("Phiên bản thay thế phải khác phiên bản nguồn trước.")) })]}><Input placeholder={source ? "Nhập phiên bản mới" : "VD: v1"} /></Form.Item>
          <Form.Item name="mappingVersion" label="Phiên bản ánh xạ" rules={required}><Input placeholder="VD: MAP-2026-10-01" /></Form.Item>
          <Form.Item name="preparedBy" label="Người chuẩn bị nguồn" rules={required}><Input /></Form.Item>
          <Form.Item name="sourceApprovedBy" label="Người phê chuẩn nguồn" extra="Có thể để trống khi lưu nháp; trước kiểm tra/xác nhận phải có người phê chuẩn, ngày và tham chiếu hoặc tệp bằng chứng."><Input /></Form.Item>
          <Form.Item name="sourceApprovedAt" label="Ngày phê chuẩn nguồn" rules={[{ validator: (_, value) => !value || value <= new Date().toISOString().slice(0, 10) ? Promise.resolve() : Promise.reject(new Error("Ngày phê chuẩn không được ở tương lai.")) }]} extra="Có thể để trống khi lưu nháp; bắt buộc cùng người phê chuẩn trước kiểm tra/xác nhận."><Input type="date" /></Form.Item>
          <Form.Item name="sourceApprovalReference" label="Tham chiếu phê chuẩn" extra="Tùy chọn khi có tệp bằng chứng; trước kiểm tra/xác nhận cần tham chiếu này hoặc tệp PDF/PNG/JPEG/TXT."><Input /></Form.Item>
          <Form.Item name="reason" label="Lý do / phạm vi nhận" rules={required} className="form-span-2"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="supersedesBatchId" hidden><Input /></Form.Item>
        </div>
        <Form.Item name="attendancePeriodIds" label="Kỳ công đã khóa tham chiếu" dependencies={["lines"]} rules={[({ getFieldValue }) => ({ validator: (_, value) => {
          const needsAttendance = (getFieldValue("lines") as PayrollInputLine[] | undefined)?.some((line) => line.inputType === "TIME" && line.calculationMode === "FORMULA" && line.valueState !== "MISSING" && line.valueState !== "NOT_APPLICABLE");
          return !needsAttendance || value?.length ? Promise.resolve() : Promise.reject(new Error("Nguồn thời gian theo công thức cần chọn kỳ công đã khóa tham chiếu."));
        } })]} extra="Chỉ dùng cho dòng thời gian theo công thức; hệ thống sẽ kiểm tra kỳ có bao phủ ngày và đúng cơ sở.">
          <Select ref={preserveRequiredCombobox} mode="multiple" loading={attendance.isLoading} disabled={attendance.isError} options={(attendance.data?.periods ?? []).filter((period: AttendancePeriod) => period.status === "LOCKED").map((period: AttendancePeriod) => ({ value: period.id, label: `${period.code} · ${day(period.startDate)}–${day(period.endDate)} · Đã khóa` }))} placeholder={attendance.isError ? "Không tải được kỳ công tham chiếu" : "Chọn kỳ công đã khóa"} />
        </Form.Item>
        {attendance.isError && <Alert type="warning" showIcon message="Không tải được danh sách kỳ công tham chiếu" description="Nguồn không có dòng thời gian vẫn có thể tiếp tục. Nếu có nguồn thời gian theo công thức, hãy tải lại để chọn kỳ công đã khóa." />}
        <Alert type="warning" showIcon message="Bằng chứng tệp được tải lên sau khi lô đã được nhận" description="Trước kiểm tra/xác nhận phải có người phê chuẩn và ngày phê chuẩn, kèm tham chiếu phê chuẩn hoặc tệp bằng chứng. Tải tệp PDF, PNG, JPEG hoặc TXT từ chi tiết lô." />
        {!importFile && <><Divider /><div className="payroll-input-section-heading"><div><Title level={3}>Dòng đầu vào</Title><Text type="secondary">Mỗi dòng có mã nguồn ổn định. Decimal là chuỗi, không dùng số mũ; 0 phải chọn “Xác nhận bằng 0”.</Text></div></div>
          <Form.List name="lines" rules={[{ validator: async (_, lines) => lines?.length ? Promise.resolve() : Promise.reject(new Error("Thêm ít nhất một dòng nguồn.")) }]}>{(fields, { add, remove }, { errors }) => <><Space direction="vertical" size={16} className="full-width">{fields.map((field, index) => <PayrollInputLineEditor key={field.key} field={field} index={index} form={form} remove={remove} allowedInputTypes={context.inputTypes} configurationOrgUnitId={selectedPeriod?.siteOrgUnitId} teamAllocationKeys={teamAllocationKeys} />)}</Space><Form.ErrorList errors={errors} /><Button icon={<PlusOutlined />} onClick={() => add()}>Thêm dòng nguồn</Button></>}</Form.List></>}
        <Divider /><div className="payroll-input-section-heading"><div><Title level={3}>Tổng và phân bổ tổ</Title><Text type="secondary">Chỉ khai báo khi nguồn sản phẩm hoặc khoán dùng phân bổ tổ đã xác nhận. Tổng từng nhóm phải bằng tổng tiền phân bổ của các dòng.</Text></div></div>
        <Form.List name="teamAllocations">{(fields, { add, remove }) => <Space direction="vertical" size={12} className="full-width">{fields.map((field, index) => <div className="payroll-team-allocation" key={field.key}><div className="payroll-input-form-grid"><Form.Item name={[field.name, "key"]} label="Khóa phân bổ" rules={required}><Input /></Form.Item><Form.Item name={[field.name, "teamOrgUnitId"]} label="Tổ" rules={[{ required: true, message: "Chọn tổ." }]}><Select ref={preserveRequiredCombobox} options={context.units.filter((unit) => unit.type === "TEAM").map((unit) => ({ value: unit.id, label: `${unit.code} · ${unit.name}` }))} /></Form.Item><Form.Item name={[field.name, "acceptedAmount"]} label="Tổng đã nhận (VND)" rules={[...required, { validator: exactDecimal }]}><Input inputMode="decimal" /></Form.Item><Form.Item name={[field.name, "reference"]} label="Tham chiếu nhóm" rules={required}><Input /></Form.Item></div><Button danger type="text" onClick={() => remove(field.name)}>Bỏ nhóm {index + 1}</Button></div>)}<Button onClick={() => add()} icon={<PlusOutlined />}>Thêm nhóm phân bổ tổ</Button></Space>}</Form.List>
      </Form>
    </Space>
  </Drawer>;
}

function ActionDialog({ batch, action, onClose, onSaved }: { batch: PayrollBatch; action: "validate" | "confirm" | "return"; onClose: () => void; onSaved: (batch: PayrollBatch) => void }) {
  const [form] = Form.useForm<{ reason: string }>();
  const definitions = { validate: { title: "Kiểm tra lô đầu vào", label: "Kiểm tra", note: "Hệ thống kiểm tra đầy đủ nguồn, kế hoạch, công thức, đơn vị, phân bổ và điều kiện phê chuẩn. Lỗi chặn được lưu theo dòng; lô vẫn không sử dụng được." }, confirm: { title: "Xác nhận nguồn đầu vào", label: "Xác nhận nguồn", note: "Chỉ lô đã kiểm tra không có lỗi, có người phê chuẩn/ngày hợp lệ và có tham chiếu hoặc tệp bằng chứng mới được xác nhận. Xác nhận tạo nguồn bất biến, không phải khóa kỳ lương." }, return: { title: "Trả lại nguồn đầu vào", label: "Trả lại", note: "Lô bị trả lại sẽ không dùng cho kỳ lương. Không có dữ liệu nguồn nào bị sửa im lặng." } }[action];
  const mutation = useMutation({ mutationFn: ({ reason }: { reason: string }) => action === "validate" ? payrollInputsApi.validate(batch.id, batch.revision, reason) : action === "confirm" ? payrollInputsApi.confirm(batch.id, batch.revision, reason) : payrollInputsApi.returnBatch(batch.id, batch.revision, reason), onSuccess: ({ item }) => onSaved(item) });
  return <Modal open title={definitions.title} okText={definitions.label} cancelText="Hủy" okButtonProps={{ danger: action === "return" }} confirmLoading={mutation.isPending} onCancel={() => !mutation.isPending && onClose()} onOk={() => form.submit()} destroyOnClose>
    <Alert type={action === "return" ? "warning" : "info"} showIcon message={definitions.note} />
    <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)} disabled={mutation.isPending}><Form.Item name="reason" label={action === "return" ? "Lý do trả lại" : "Ghi chú xử lý"} rules={required}><Input.TextArea rows={3} autoFocus /></Form.Item>{mutation.error instanceof ApiError && mutation.error.status === 409 ? <Alert type="warning" showIcon message="Lô đã thay đổi trong khi bạn xử lý" description="Nội dung ghi chú vẫn được giữ. Đóng hộp thoại, tải lại lô để lấy phiên bản mới rồi thực hiện lại thao tác." /> : mutation.isError ? <Alert type="error" showIcon message="Không thực hiện được thao tác" description={errorMessage(mutation.error)} /> : null}</Form>
  </Modal>;
}

function BatchDetails({ id, canManage, onClose, onClone }: { id: string; canManage: boolean; onClose: () => void; onClone: (batch: PayrollBatch) => void }) {
  const screens = Grid.useBreakpoint();
  const client = useQueryClient();
  const { message } = App.useApp();
  const detail = useQuery({ queryKey: ["payroll-input-batch", id], queryFn: () => payrollInputsApi.detail(id) });
  const batch = detail.data?.item;
  const [action, setAction] = useState<"validate" | "confirm" | "return">();
  const [evidenceFile, setEvidenceFile] = useState<File>();
  const upload = useMutation({ mutationFn: () => payrollInputsApi.uploadEvidence(id, evidenceFile!), onSuccess: ({ item }) => { client.setQueryData(["payroll-input-batch", id], { item }); void client.invalidateQueries({ queryKey: ["payroll-inputs"] }); setEvidenceFile(undefined); message.success("Đã tải bằng chứng và cập nhật phiên bản lô."); } });
  const update = (item: PayrollBatch) => { client.setQueryData(["payroll-input-batch", id], { item }); void client.invalidateQueries({ queryKey: ["payroll-inputs"] }); setAction(undefined); };
  const downloadEvidence = async (evidence: { id: string; fileName: string }) => { try { download(await payrollInputsApi.evidenceDownload(id, evidence.id), evidence.fileName); } catch (error) { message.error(errorMessage(error)); } };
  const evidenceFiles: UploadFile[] = evidenceFile ? [{ uid: evidenceFile.name, name: evidenceFile.name, size: evidenceFile.size, type: evidenceFile.type, status: "done" }] : [];
  const lineColumns: ColumnsType<PayrollBatchLine> = [
    { title: "Mã dòng", dataIndex: "sourceLineId", fixed: "left", width: 145 },
    { title: "Nhân viên", width: 210, render: (_, line) => <><strong>{line.employeeCode}</strong><span className="table-subtext">{line.employeeName}</span></> },
    { title: "Cấu phần", width: 210, render: (_, line) => <><strong>{line.componentCode}</strong><span className="table-subtext">{line.componentName}</span></> },
    { title: "Khoảng làm việc", width: 180, render: (_, line) => `${day(line.workFrom)} – ${day(line.workTo)}` },
    { title: "Dữ liệu", width: 260, render: (_, line) => <><Tag>{inputTypeLabel(line.inputType)}</Tag> <Tag color={line.valueState === "MISSING" ? "red" : line.valueState === "CONFIRMED_ZERO" ? "blue" : "default"}>{valueStateLabel(line.valueState)}</Tag><span className="table-subtext">{line.calculationMode === "AMOUNT" ? `${decimal(line.amount)} ${line.unit ?? ""}` : line.formulaCode ? `Công thức ${line.formulaCode}` : "Không có dữ liệu công thức"}</span>{line.inputs?.map(input => <span key={input.code} className="table-subtext">{input.code}: {decimal(input.value)} {input.unit}</span>)}{line.businessReference && <span className="table-subtext">Căn cứ: {line.businessReference}</span>}{line.amountBasis && <span className="table-subtext">{line.amountBasis}</span>}</> },
    { title: "Phân bổ", width: 190, render: (_, line) => line.teamAllocationKey ? <><strong>{line.teamAllocationKey}</strong><span className="table-subtext">{decimal(line.allocatedAmount)} VND</span></> : "Cá nhân" },
  ];
  return <Drawer open title={batch ? `Nguồn đầu vào · ${batch.code}` : "Nguồn đầu vào"} width={screens.lg ? 1080 : "100%"} onClose={onClose} className="payroll-input-detail" extra={batch ? <Space wrap>{canManage && batch.canManage && batch.status !== "SUPERSEDED" && batch.payrollPeriod.status === "OPEN" && <Button onClick={() => onClone(batch)}>Lập phiên bản thay thế</Button>}{canManage && batch.canManage && ["DRAFT", "VALIDATED"].includes(batch.status) && <Button onClick={() => setAction("validate")}>Kiểm tra</Button>}{canManage && batch.canManage && batch.status === "VALIDATED" && <Button type="primary" onClick={() => setAction("confirm")}>Xác nhận nguồn</Button>}{canManage && batch.canManage && ["DRAFT", "VALIDATED", "CONFIRMED"].includes(batch.status) && <Button danger onClick={() => setAction("return")}>Trả lại</Button>}</Space> : null}>
    {detail.isLoading ? <Skeleton active /> : detail.isError ? <Alert type="error" showIcon message="Không tải được lô đầu vào" description={errorMessage(detail.error)} /> : !batch ? <Empty description="Không có dữ liệu." /> : <Space direction="vertical" size={16} className="full-width" tabIndex={0} role="region" aria-label="Chi tiết nguồn đầu vào lương; dùng phím mũi tên để cuộn">
      {batch.provenance === "SIMULATION" && <Alert type="warning" showIcon message="Nguồn mô phỏng" description="Nhãn nguồn mô phỏng độc lập với trạng thái xử lý. Xác nhận nguồn không tự chuyển mô phỏng thành xác nhận nghiệp vụ." />}
      <Descriptions bordered size="small" column={screens.md ? 2 : 1} items={[
        { key: "status", label: "Trạng thái", children: statusTag(batch.status) }, { key: "revision", label: "Phiên bản dữ liệu", children: batch.revision },
        { key: "period", label: "Kỳ nhận đầu vào lương", children: `${batch.payrollPeriod.code} · ${batch.payrollPeriod.siteName} · ${day(batch.payrollPeriod.dateFrom)}–${day(batch.payrollPeriod.dateTo)}` }, { key: "payment", label: "Ngày chi trả dự kiến", children: day(batch.payrollPeriod.expectedPaymentDate) },
        { key: "source", label: "Nguồn / chứng từ / phiên bản", children: `${batch.sourceSystem} · ${batch.sourceDocumentNo} · ${batch.sourceVersion}` }, { key: "mapping", label: "Phiên bản ánh xạ", children: batch.mappingVersion },
        { key: "prepared", label: "Người chuẩn bị", children: batch.preparedBy }, { key: "approval", label: "Phê chuẩn nguồn", children: batch.sourceApprovedBy ? `${batch.sourceApprovedBy} · ${day(batch.sourceApprovedAt)} · ${batch.sourceApprovalReference ?? (batch.evidence.length ? "Bằng chứng tệp đã tải" : "Chưa có tham chiếu/bằng chứng")}` : "Chưa khai báo" },
        { key: "reason", label: "Lý do / phạm vi", children: batch.reason },
      ]} />
      <section><Title level={3}>Lỗi và kiểm tra</Title>{batch.validation.issues.length ? <ul className="payroll-input-issues">{batch.validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.code}</strong> · {issue.message}{issue.sourceLineId ? ` · dòng ${issue.sourceLineId}` : ""}</li>)}</ul> : <Alert type={batch.status === "VALIDATED" || batch.status === "CONFIRMED" ? "success" : "info"} showIcon message={batch.status === "VALIDATED" || batch.status === "CONFIRMED" ? "Không có lỗi kiểm tra đang lưu." : "Chưa có kết quả kiểm tra."} />}</section>
      <section><Title level={3}>Dòng nguồn</Title><div className="table-panel payroll-input-lines-table"><Table rowKey="id" size="small" components={tableComponents} columns={lineColumns} dataSource={batch.lines} pagination={false} scroll={{ x: 1150 }} /></div></section>
      <section><Title level={3}>Tổng và phân bổ tổ</Title>{batch.teamAllocations.length ? <Descriptions bordered size="small" column={1} items={batch.teamAllocations.map((allocation) => ({ key: allocation.key, label: allocation.key, children: `${decimal(allocation.acceptedAmount)} VND · ${allocation.reference}` }))} /> : <Text type="secondary">Lô không có phân bổ tổ.</Text>}</section>
      <section><Title level={3}>Bằng chứng nguồn</Title>{canManage && batch.canManage && ["DRAFT", "VALIDATED"].includes(batch.status) && batch.payrollPeriod.status === "OPEN" && <Space wrap className="payroll-evidence-upload"><Upload beforeUpload={(file) => { setEvidenceFile(file); return false; }} onRemove={() => { setEvidenceFile(undefined); return true; }} fileList={evidenceFiles} maxCount={1} accept="application/pdf,image/png,image/jpeg,text/plain,.pdf,.png,.jpg,.jpeg,.txt"><Button icon={<UploadOutlined />}>Chọn tệp bằng chứng</Button></Upload><Button type="primary" disabled={!evidenceFile} loading={upload.isPending} onClick={() => upload.mutate()}>Tải bằng chứng</Button></Space>}{upload.isError && <Alert type="error" showIcon message="Không tải được bằng chứng" description={errorMessage(upload.error)} />}{batch.evidence.length ? <Table rowKey="id" size="small" components={tableComponents} pagination={false} dataSource={batch.evidence} columns={[{ title: "Tệp", dataIndex: "fileName" }, { title: "Loại", dataIndex: "contentType" }, { title: "Dung lượng", dataIndex: "size", render: (size) => `${new Intl.NumberFormat("vi-VN").format(size)} byte` }, { title: "Tải", key: "download", render: (_, evidence) => <Button type="link" icon={<DownloadOutlined />} onClick={() => void downloadEvidence(evidence)}>Tải xuống</Button> }]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có tệp bằng chứng." />}</section>
      <section><Title level={3}>Lịch sử xử lý</Title><Table rowKey="id" size="small" components={tableComponents} pagination={false} dataSource={batch.history} scroll={{ x: 760 }} columns={[{ title: "Thời điểm", dataIndex: "createdAt", width: 180, render: time }, { title: "Thao tác", dataIndex: "action", render: (value: string) => actionLabels[value] ?? value }, { title: "Chuyển trạng thái", width: 180, render: (_, row) => `${row.fromStatus ? statusLabels[row.fromStatus as PayrollInputStatus] ?? row.fromStatus : "Khởi tạo"} → ${statusLabels[row.toStatus as PayrollInputStatus] ?? row.toStatus}` }, { title: "Người thực hiện", width: 170, render: (_, row) => row.actor.displayName }, { title: "Lý do", dataIndex: "reason" }]} /></section>
      <details><summary>Chi tiết kỹ thuật và liên kết điều chỉnh</summary><p>Mã băm nội dung: <code className="payroll-hash">{batch.contentHash}</code></p><ul>{batch.lines.map(line => <li key={line.id}>{line.sourceLineId}: <code>{line.id}</code>{line.adjustmentOfLineId && <> · Điều chỉnh nguồn <code>{line.adjustmentOfLineId}</code></>}</li>)}</ul></details>
    </Space>}
    {batch && action && <ActionDialog batch={batch} action={action} onClose={() => setAction(undefined)} onSaved={update} />}
  </Drawer>;
}

export function PayrollInputsWorkspace({ user }: { user: AuthUser }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const canManage = user.roles.includes("KT") && user.permissions.includes("payroll.inputs.manage");
  const [periodId, setPeriodId] = useState<string>();
  const [status, setStatus] = useState<PayrollInputStatus>();
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [page, setPage] = useState(1);
  const [periodEditor, setPeriodEditor] = useState(false);
  const [editor, setEditor] = useState<{ source?: PayrollBatch; file?: File }>();
  const [selectedId, setSelectedId] = useState<string>();
  const context = useQuery({ queryKey: ["payroll-inputs-context"], queryFn: payrollInputsApi.context });
  const periods = useQuery({ queryKey: ["payroll-input-periods"], queryFn: payrollInputsApi.periods, enabled: context.isSuccess });
  const filter: PayrollBatchFilter = { payrollPeriodId: periodId, status, search: search || undefined, page, pageSize: 20 };
  const list = useQuery({ queryKey: ["payroll-inputs", filter], queryFn: () => payrollInputsApi.list(filter), enabled: context.isSuccess });
  useEffect(() => { setPage(1); }, [periodId, status, search]);
  const save = (batch: PayrollBatch, duplicate: boolean) => { setEditor(undefined); setSelectedId(batch.id); void client.invalidateQueries({ queryKey: ["payroll-inputs"] }); message.success(duplicate ? "Nguồn cùng nội dung đã tồn tại; không tạo lô mới." : "Đã nhận lô đầu vào. Đối chiếu phê chuẩn và tham chiếu hoặc tệp chứng từ trước khi xác nhận."); };
  const template = useMutation({ mutationFn: payrollInputsApi.template, onSuccess: (blob) => download(blob, "mau-dau-vao-luong.csv") });
  const csvFiles: UploadFile[] = editor?.file ? [{ uid: editor.file.name, name: editor.file.name, size: editor.file.size, type: editor.file.type, status: "done" }] : [];
  const columns: ColumnsType<PayrollBatchSummary> = [
    { title: "Mã lô", dataIndex: "code", fixed: "left", width: 150, render: (code, row) => <><strong>{code}</strong><span className="table-subtext">r{row.revision} · {row.createdBy.displayName}</span></> },
    { title: "Kỳ nhận đầu vào", width: 220, render: (_, row) => <><strong>{row.payrollPeriod.code}</strong><span className="table-subtext">{row.payrollPeriod.siteName} · {day(row.payrollPeriod.dateFrom)}–{day(row.payrollPeriod.dateTo)}</span></> },
    { title: "Nguồn", width: 220, render: (_, row) => <><strong>{row.sourceSystem} · {row.sourceDocumentNo}</strong><span className="table-subtext">Phiên bản {row.sourceVersion} · {provenanceLabels[row.provenance]}</span></> },
    { title: "Trạng thái", width: 155, render: (_, row) => <>{statusTag(row.status)}{row.issueCount ? <span className="table-subtext payroll-input-issue-count">{row.issueCount} lỗi kiểm tra</span> : null}</> },
    { title: "Dòng", width: 90, align: "right", dataIndex: "lineCount" },
    { title: "Tạo lúc", width: 165, dataIndex: "createdAt", render: time },
    { title: "Thao tác", fixed: "right", width: 110, render: (_, row) => <Button type="link" onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); }}>Xem nguồn</Button> },
  ];
  if (context.isLoading) return <div className="content-loading"><Skeleton active /></div>;
  if (context.isError || !context.data) return <Alert type="error" showIcon message="Không tải được phạm vi đầu vào lương" description={errorMessage(context.error)} />;
  return <section className="payroll-inputs-workspace" aria-labelledby="payroll-inputs-title">
    <div className="page-heading"><div><p className="eyebrow">TIẾP NHẬN NGUỒN LƯƠNG</p><Title id="payroll-inputs-title" level={1}>Đầu vào lương</Title><Paragraph type="secondary">Nhận nguồn theo kỳ lương, kiểm tra kế hoạch/công thức và xác nhận nguồn bất biến cho bộ máy tính lương tương lai.</Paragraph></div>{canManage && <Space wrap><Button onClick={() => setPeriodEditor(true)}>Tạo kỳ nhận</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({})}>Nhận đầu vào</Button></Space>}</div>
    {periods.isError ? <Alert type="error" showIcon message="Không tải được kỳ nhận đầu vào" description={errorMessage(periods.error)} /> : <><Alert type="info" showIcon message="Kỳ nhận đầu vào lương độc lập với kỳ công" description="Kỳ công đã khóa chỉ là nguồn tham chiếu cho dữ liệu thời gian. Kỳ lương ở đây không có thao tác khóa hoặc phê duyệt bảng lương." />
      <section className="workspace-filters payroll-input-filters" aria-label="Bộ lọc đầu vào lương"><div className="workspace-filter"><label htmlFor="payroll-input-period">Kỳ nhận đầu vào</label><Select id="payroll-input-period" allowClear value={periodId} onChange={setPeriodId} placeholder="Tất cả kỳ được phép" options={(periods.data?.items ?? []).map((period) => ({ value: period.id, label: `${period.code} · ${period.siteName} · ${period.status === "OPEN" ? "Đang mở" : "Đã khóa"}` }))} /></div><div className="workspace-filter"><label htmlFor="payroll-input-status">Trạng thái lô</label><Select id="payroll-input-status" allowClear value={status} onChange={setStatus} placeholder="Tất cả trạng thái" options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} /></div><div className="workspace-filter workspace-search"><label htmlFor="payroll-input-search">Tìm nguồn</label><Input.Search id="payroll-input-search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} onSearch={() => setSearch(draftSearch.trim())} placeholder="Mã lô, chứng từ, nguồn…" enterButton="Tìm" /></div><Button onClick={() => { setDraftSearch(""); setSearch(""); setStatus(undefined); setPeriodId(undefined); }}>Xóa lọc</Button></section>
      {canManage && <section className="panel payroll-input-import"><div><Title level={3}>Nhập tệp CSV</Title><Text type="secondary">Tệp UTF-8 tối đa 5 MB, tối đa 500 dòng nhóm. Metadata luôn được nhập bằng biểu mẫu có nhãn, không dùng JSON thô.</Text></div><Space wrap><Button icon={<DownloadOutlined />} loading={template.isPending} onClick={() => template.mutate()}>Tải mẫu CSV</Button><Upload beforeUpload={(file) => { setEditor({ file }); return false; }} fileList={csvFiles} maxCount={1} accept=".csv,text/csv"><Button icon={<UploadOutlined />}>Chọn CSV</Button></Upload></Space>{template.isError && <Alert type="error" showIcon message="Không tải được mẫu CSV" description={errorMessage(template.error)} />}</section>}
      {list.isError ? <Alert type="error" showIcon message="Không tải được danh sách lô" description={errorMessage(list.error)} /> : <section className="table-panel payroll-input-list-table"><Table rowKey="id" components={tableComponents} columns={columns} dataSource={list.data?.items ?? []} loading={list.isLoading || list.isFetching} onRow={(row) => ({ onClick: () => setSelectedId(row.id), className: "clickable-row" })} scroll={{ x: 1260 }} pagination={false} locale={{ emptyText: <Empty description={search || status || periodId ? "Không có lô phù hợp bộ lọc." : "Chưa có lô đầu vào lương."} /> }} /><div className="table-footer"><Text type="secondary">{list.data?.total ?? 0} lô trong phạm vi được phép</Text><Pagination current={list.data?.page ?? page} pageSize={list.data?.pageSize ?? 20} total={list.data?.total ?? 0} showSizeChanger={false} onChange={setPage} /></div></section>}
    </>}
    {periodEditor && <PayrollPeriodEditor context={context.data} onClose={() => setPeriodEditor(false)} onSaved={(period) => { setPeriodEditor(false); setPeriodId(period.id); void client.invalidateQueries({ queryKey: ["payroll-input-periods"] }); message.success("Đã tạo kỳ nhận đầu vào lương."); }} />}
    {editor && <BatchEditor context={context.data} periods={periods.data?.items ?? []} source={editor.source} importFile={editor.file} onClose={() => setEditor(undefined)} onSaved={save} />}
    {selectedId && <BatchDetails id={selectedId} canManage={canManage} onClose={() => setSelectedId(undefined)} onClone={(batch) => { setSelectedId(undefined); setEditor({ source: batch }); }} />}
  </section>;
}
