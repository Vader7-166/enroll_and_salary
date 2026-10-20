import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { HTMLAttributes } from "react";
import { ApiError, errorMessage } from "../api/client";
import { organizationApi } from "../api/hrtp";
import type { OrgUnit } from "../api/hrtp";
import { settingsApi } from "../api/hr-next";
import type { LegalParameter } from "../api/hr-next";
import { TechnicalDetails } from "./TechnicalDetails";

const { Text, Paragraph } = Typography;
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
type ParameterDefinition = { label: string; unit: string; unitLabel: string; kind: "number" | "date" | "text" | "calendar" };
const definitions: Record<string, ParameterDefinition> = {};
for (const region of ["I", "II", "III", "IV"]) {
  definitions[`MIN_WAGE_MONTH_${region}`] = { label: `Lương tối thiểu tháng — vùng ${region}`, unit: "VND/month", unitLabel: "đồng/tháng", kind: "number" };
  definitions[`MIN_WAGE_HOUR_${region}`] = { label: `Lương tối thiểu giờ — vùng ${region}`, unit: "VND/hour", unitLabel: "đồng/giờ", kind: "number" };
}
for (const [code, label, unit, unitLabel] of [
  ["PROBATION_MIN_RATIO", "Tỷ lệ lương thử việc tối thiểu", "ratio", "hệ số (1 = 100%)"],
  ["PROBATION_MAX_DAYS_TECHNICAL", "Thời gian thử việc tối đa — kỹ thuật", "day", "ngày"],
  ["PROBATION_MAX_DAYS_WORKER", "Thời gian thử việc tối đa — công nhân", "day", "ngày"],
  ["FIXED_TERM_MIN_MONTHS", "Thời hạn hợp đồng tối thiểu theo cấu hình", "month", "tháng"],
  ["FIXED_TERM_MAX_MONTHS", "Thời hạn hợp đồng xác định thời hạn tối đa", "month", "tháng"],
  ["FIXED_TERM_MAX_COUNT", "Số lần ký hợp đồng xác định thời hạn tối đa", "count", "lần"],
  ["INSURANCE_MIN_CONTRACT_MONTHS", "Thời hạn hợp đồng tối thiểu để xét bảo hiểm", "month", "tháng"],
  ["SHIFT_MAX_DAILY_MINUTES", "Thời gian làm việc tối đa mỗi ngày", "minute", "phút"],
  ["SHIFT_MAX_WEEKLY_MINUTES", "Thời gian làm việc tối đa mỗi tuần", "minute", "phút"],
  ["SHIFT_MIN_REST_MINUTES", "Thời gian nghỉ tối thiểu giữa hai ca", "minute", "phút"],
  ["SHIFT_MIN_DAY_BREAK_MINUTES", "Nghỉ giữa ca tối thiểu — ca ngày", "minute", "phút"],
  ["SHIFT_MIN_NIGHT_BREAK_MINUTES", "Nghỉ giữa ca tối thiểu — ca đêm", "minute", "phút"],
  ["PUNCH_IN_BEFORE_MINUTES", "Nhận lượt vào trước giờ bắt đầu ca", "minute", "phút"],
  ["PUNCH_IN_AFTER_MINUTES", "Nhận lượt vào sau giờ bắt đầu ca", "minute", "phút"],
  ["PUNCH_OUT_BEFORE_MINUTES", "Nhận lượt ra trước giờ kết thúc ca", "minute", "phút"],
  ["PUNCH_OUT_AFTER_MINUTES", "Nhận lượt ra sau giờ kết thúc ca", "minute", "phút"],
  ["PUNCH_DUPLICATE_WINDOW_MINUTES", "Khoảng nhận diện lượt chấm công trùng", "minute", "phút"],
  ["OT_DAILY_MAX_RATIO", "Tỷ lệ tăng ca tối đa so với giờ làm bình thường", "ratio", "hệ số (1 = 100%)"],
  ["OT_MONTH_MAX_MINUTES", "Giới hạn tăng ca mỗi tháng", "minute", "phút"],
  ["OT_YEAR_MAX_MINUTES", "Giới hạn tăng ca mỗi năm", "minute", "phút"],
] as const) definitions[code] = { label, unit, unitLabel, kind: "number" };
definitions.HOLIDAY_CALENDAR = { label: "Lịch ngày nghỉ lễ", unit: "date-list", unitLabel: "danh sách ngày", kind: "calendar" };
definitions.OT_300_NOTICE_REFERENCE = { label: "Căn cứ thông báo tăng ca đến 300 giờ/năm", unit: "reference", unitLabel: "tham chiếu", kind: "text" };
definitions.OT_300_NOTICE_DATE = { label: "Ngày thông báo tăng ca đến 300 giờ/năm", unit: "date", unitLabel: "ngày", kind: "date" };
const basisLabels: Record<string, string> = { WORK_DATE: "Theo ngày làm việc", TAX_YEAR: "Theo năm tính thuế", PAYMENT_DATE: "Theo ngày chi trả" };
const unitLabels: Record<string, string> = { "VND/month": "đồng/tháng", "VND/hour": "đồng/giờ", ratio: "hệ số", day: "ngày", month: "tháng", count: "lần", minute: "phút", date: "ngày", reference: "tham chiếu", "date-list": "danh sách ngày" };
const popup = (trigger: HTMLElement) => trigger.parentElement!;
const required = [{ required: true, message: "Vui lòng nhập hoặc chọn thông tin này." }];
function preserveRequiredCombobox(select: { nativeElement: HTMLElement } | null) {
  // Keep aria-required on the combobox input, not rc-select's generic wrapper.
  select?.nativeElement.removeAttribute("aria-required");
}
function ParameterTableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Dữ liệu tham số pháp lý" />;
}
function realDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
const dateRules = [{ required: true, message: "Chọn ngày." }, { validator: (_: unknown, value?: string) => !value || realDate(value) ? Promise.resolve() : Promise.reject(new Error("Ngày không hợp lệ.")) }];
function scopeLabel(scope: string, units: OrgUnit[]) {
  if (scope === "GLOBAL") return "Toàn công ty";
  if (/^REGION:(I|II|III|IV)$/.test(scope)) return `Vùng lương ${scope.slice(7)}`;
  return units.find(unit => unit.siteId === scope.slice(5) && ["SITE", "HEADQUARTERS"].includes(unit.type))?.name
    ?? units.find(unit => unit.siteId === scope.slice(5))?.pathLabel ?? "Phạm vi cơ sở (xem chi tiết)";
}
function ParameterValue({ item }: { item: LegalParameter }) {
  const definition = definitions[item.paramCode];
  const value = item.value;
  if (definition?.kind === "calendar" && value && typeof value === "object" && "dates" in value && Array.isArray(value.dates)) {
    const calendar = value as { dates: unknown[]; status?: string; reference?: string };
    return <div><Space wrap>{calendar.dates.map((date, index) => <Tag key={index}>{typeof date === "string" ? date : "Ngày cần kiểm tra"}</Tag>)}</Space><small className="table-subtext">{calendar.status === "BUSINESS_CONFIRMED" ? "Đã xác nhận nghiệp vụ" : calendar.status === "SIMULATION" ? "Lịch mô phỏng" : "Trạng thái cần kiểm tra"}{calendar.reference ? ` · ${calendar.reference}` : ""}</small></div>;
  }
  if ((typeof value === "string" || typeof value === "number") && /^-?\d+(\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    return <span className="numeric">{new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 12 }).format(number)} {unitLabels[item.unit] ?? "(đơn vị trong chi tiết)"}{item.unit === "ratio" ? ` (${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(number * 100)}%)` : ""}</span>;
  }
  if (typeof value === "string" || typeof value === "boolean") return <>{typeof value === "boolean" ? value ? "Có" : "Không" : value}</>;
  return <Text type="secondary">Cấu hình mở rộng — xem chi tiết kỹ thuật</Text>;
}
type Values = {
  selection: string; customCode?: string; scopeKey: string; subjectType: string; customSubject?: string;
  applicationBasis: LegalParameter["applicationBasis"]; value?: string; unit?: string; customValue?: string;
  holidayDates?: { date: string }[]; holidayStatus?: string; holidayReference?: string;
  effectiveFrom: string; effectiveTo?: string; documentEffectiveDate: string; legalBasis: string;
};
function ParameterForm({ open, loading, error, items, units, onClose, onSubmit }: { open: boolean; loading: boolean; error: Error | null; items: LegalParameter[]; units: OrgUnit[]; onClose: () => void; onSubmit: (value: Omit<LegalParameter, "id">) => void }) {
  const [form] = Form.useForm<Values>();
  const selection = Form.useWatch("selection", form);
  const subject = Form.useWatch("subjectType", form);
  const definition = definitions[selection];
  const known = Boolean(definition);
  const scopes = [{ value: "GLOBAL", label: "Toàn công ty" }, ...["I", "II", "III", "IV"].map(region => ({ value: `REGION:${region}`, label: `Vùng lương ${region}` })), ...Array.from(new Map(units.filter(unit => unit.siteId).map(unit => [unit.siteId!, { value: `SITE:${unit.siteId}`, label: scopeLabel(`SITE:${unit.siteId}`, units) }])).values())];
  const submit = (values: Values) => {
    let value: unknown = values.value;
    if (definition?.kind === "calendar") value = { dates: (values.holidayDates ?? []).map(item => item.date), status: values.holidayStatus, reference: values.holidayReference?.trim() };
    if (!known) { const text = values.customValue!.trim(); value = /^-?\d+(\.\d+)?$/.test(text) ? text : JSON.parse(text); }
    const existing = items.find(item => item.paramCode === selection);
    onSubmit({ paramCode: selection === "CUSTOM" ? values.customCode!.trim() : selection, scopeKey: values.scopeKey, subjectType: subject === "CUSTOM" ? values.customSubject!.trim() : subject,
      applicationBasis: values.applicationBasis, value, unit: known ? definition.unit : values.unit?.trim() || existing?.unit || "value", effectiveFrom: values.effectiveFrom,
      effectiveTo: values.effectiveTo || null, documentEffectiveDate: values.documentEffectiveDate, legalBasis: values.legalBasis.trim() });
  };
  const options = [...Object.entries(definitions).map(([value, definition]) => ({ value, label: definition.label })), ...Array.from(new Set(items.filter(item => !definitions[item.paramCode]).map(item => item.paramCode))).map(value => ({ value, label: `Tham số mở rộng: ${value}` })), { value: "CUSTOM", label: "Tham số khác (thiết lập nâng cao)" }];
  return <Modal className="parameter-modal" title="Thêm phiên bản tham số" open={open} onCancel={onClose} footer={null} width={800} destroyOnHidden afterClose={() => form.resetFields()}>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={loading} initialValues={{ scopeKey: "GLOBAL", subjectType: "ALL", applicationBasis: "WORK_DATE", holidayStatus: "SIMULATION", holidayDates: [] }} onFinish={submit}>
      <Form.Item name="selection" label="Tham số cần thiết lập" rules={required}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" virtual={false} getPopupContainer={popup} options={options} placeholder="Chọn tên tham số" onChange={() => form.resetFields(["value", "customValue", "unit", "holidayDates", "holidayReference"])} /></Form.Item>
      <div className="form-grid">
        <Form.Item name="scopeKey" label="Phạm vi áp dụng" rules={required}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" virtual={false} getPopupContainer={popup} options={scopes} /></Form.Item>
        <Form.Item name="subjectType" label="Đối tượng áp dụng" rules={required}><Select ref={preserveRequiredCombobox} virtual={false} getPopupContainer={popup} options={[{ value: "ALL", label: "Tất cả đối tượng" }, { value: "CUSTOM", label: "Nhóm đối tượng khác (nâng cao)" }]} /></Form.Item>
        {subject === "CUSTOM" && <Form.Item name="customSubject" label="Mã nhóm đối tượng" rules={[...required, { pattern: /^[A-Z][A-Z0-9_]{1,63}$/, message: "Dùng chữ hoa, chữ số hoặc dấu gạch dưới; bắt đầu bằng chữ." }]}><Input /></Form.Item>}
        <Form.Item name="applicationBasis" label="Xác định hiệu lực theo" rules={required}><Select ref={preserveRequiredCombobox} virtual={false} getPopupContainer={popup} options={Object.entries(basisLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        {known && definition.kind === "number" && <Form.Item name="value" label={`Giá trị (${definition.unitLabel})`} rules={[...required, { pattern: /^(0|[1-9]\d*)(\.\d+)?$/, message: "Nhập số không âm, dùng dấu chấm cho phần thập phân." }]}><InputNumber stringMode min="0" className="full-width" /></Form.Item>}
        {known && definition.kind === "date" && <Form.Item name="value" label="Ngày thông báo" rules={dateRules}><Input type="date" /></Form.Item>}
        {known && definition.kind === "text" && <Form.Item name="value" label="Số văn bản / tham chiếu" rules={[...required, { whitespace: true, message: "Nhập số văn bản hoặc tham chiếu." }]}><Input /></Form.Item>}
      </div>
      {selection && !known && <section className="parameter-advanced"><Alert type="info" showIcon message="Thiết lập nâng cao" description="Tham số mở rộng chưa có biểu mẫu chuyên biệt. Chỉ dùng khi đã có đặc tả nghiệp vụ và kiểu dữ liệu tương ứng." />
        {selection === "CUSTOM" && <Form.Item name="customCode" label="Mã tham số mở rộng" rules={[...required, { pattern: /^[A-Z][A-Z0-9_]{1,79}$/, message: "Dùng chữ hoa, chữ số hoặc dấu gạch dưới; bắt đầu bằng chữ." }]}><Input /></Form.Item>}
        <Form.Item name="unit" label="Đơn vị tính" rules={[...required, { whitespace: true, max: 32 }]}><Input /></Form.Item>
        <Form.Item name="customValue" label="Dữ liệu cấu hình nâng cao (JSON)" rules={[...required, { validator: (_: unknown, value?: string) => { if (!value) return Promise.resolve(); try { JSON.parse(value); return Promise.resolve(); } catch { return Promise.reject(new Error("Dữ liệu cấu hình chưa đúng định dạng JSON.")); } } }]}><Input.TextArea rows={4} /></Form.Item>
      </section>}
      {definition?.kind === "calendar" && <section className="holiday-editor"><Paragraph>Nhập từng ngày nghỉ lễ hoặc nghỉ bù theo lịch đã đối chiếu. Danh sách này không tự suy ngày nghỉ bù.</Paragraph>
        <Form.List name="holidayDates" rules={[{ validator: async (_, dates?: { date?: string }[]) => { const values = (dates ?? []).map(item => item.date).filter(Boolean); if (new Set(values).size !== values.length) throw new Error("Danh sách có ngày trùng. Mỗi ngày chỉ nhập một lần."); } }]}>{(fields, { add, remove }, { errors }) => <><div className="holiday-date-list">{fields.map(field => <Space key={field.key} align="baseline"><Form.Item name={[field.name, "date"]} rules={dateRules} label={`Ngày nghỉ ${field.name + 1}`}><Input type="date" /></Form.Item><Button onClick={() => remove(field.name)} aria-label={`Xóa ngày nghỉ ${field.name + 1}`}>Xóa</Button></Space>)}</div><Button onClick={() => add({ date: "" })}>Thêm ngày nghỉ</Button><Form.ErrorList errors={errors} /></>}</Form.List>
        <div className="form-grid"><Form.Item name="holidayStatus" label="Trạng thái lịch" rules={required}><Select ref={preserveRequiredCombobox} virtual={false} getPopupContainer={popup} options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }]} /></Form.Item><Form.Item name="holidayReference" label="Văn bản / căn cứ lịch nghỉ" rules={[...required, { whitespace: true }]}><Input /></Form.Item></div>
      </section>}
      <div className="form-grid"><Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={dateRules}><Input type="date" /></Form.Item><Form.Item name="effectiveTo" label="Hiệu lực đến (nếu có)" rules={[{ validator: (_, value?: string) => !value || realDate(value) ? Promise.resolve() : Promise.reject(new Error("Ngày không hợp lệ.")) }]}><Input type="date" /></Form.Item><Form.Item name="documentEffectiveDate" label="Ngày hiệu lực văn bản" rules={dateRules}><Input type="date" /></Form.Item></div>
      <Form.Item name="legalBasis" label="Căn cứ pháp lý / quyết định" rules={[...required, { whitespace: true }]}><Input.TextArea rows={2} /></Form.Item>
      {error && <Alert type="error" showIcon message="Không tạo được phiên bản tham số" description={<>{errorMessage(error)}{error instanceof ApiError && <TechnicalDetails><pre>{JSON.stringify({ code: error.code, status: error.status, message: error.rawMessage }, null, 2)}</pre></TechnicalDetails>}</>} />}
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={loading} disabled={!selection}>Tạo phiên bản</Button></Space>
    </Form>
  </Modal>;
}
export function LegalParametersPanel() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(TODAY);
  const parameters = useQuery({ queryKey: ["legal-parameters", asOf], queryFn: () => settingsApi.parameters({ asOf }) });
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  const create = useMutation({ mutationFn: settingsApi.createParameter, onSuccess: ({ parameter }) => { setAsOf(parameter.effectiveFrom); void client.invalidateQueries({ queryKey: ["legal-parameters"] }); setOpen(false); } });
  const units = context.data?.units ?? [];
  return <div className="tab-stack"><div className="history-toolbar"><Space wrap><label htmlFor="parameter-asof">Hiệu lực tại</label><Input id="parameter-asof" type="date" value={asOf} onChange={event => { if (realDate(event.target.value)) setAsOf(event.target.value); }} /></Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { create.reset(); setOpen(true); }}>Thêm phiên bản</Button></div>
    {parameters.isError ? <Alert type="error" showIcon message="Không tải được tham số" description={errorMessage(parameters.error)} /> : <Table<LegalParameter> components={{ body: { wrapper: ParameterTableBody } }} rowKey="id" loading={parameters.isLoading} size="small" scroll={{ x: 1100 }} pagination={false} dataSource={parameters.data?.items ?? []} locale={{ emptyText: <Empty description="Chưa có tham số tại ngày đã chọn" /> }} columns={[
      { title: "Tham số", width: 270, render: (_, item) => <><Text strong>{definitions[item.paramCode]?.label ?? "Tham số mở rộng"}</Text><TechnicalDetails><pre>{JSON.stringify(item, null, 2)}</pre></TechnicalDetails></> },
      { title: "Phạm vi áp dụng", width: 170, render: (_, item) => scopeLabel(item.scopeKey, units) },
      { title: "Đối tượng", width: 140, render: (_, item) => item.subjectType === "ALL" ? "Tất cả đối tượng" : "Nhóm đối tượng riêng (xem chi tiết)" },
      { title: "Căn cứ áp dụng", dataIndex: "applicationBasis", width: 150, render: value => basisLabels[value] ?? "Cần kiểm tra cấu hình" },
      { title: "Giá trị", width: 350, render: (_, item) => <ParameterValue item={item} /> },
      { title: "Hiệu lực", width: 210, render: (_, item) => `${item.effectiveFrom} — ${item.effectiveTo ?? "Không giới hạn ngày kết thúc"}` },
    ]} />}
    {context.isError && <Alert type="warning" showIcon message="Chưa tải được danh sách cơ sở" description={errorMessage(context.error)} />}
    <ParameterForm open={open} loading={create.isPending} error={create.error} items={parameters.data?.items ?? []} units={units} onClose={() => setOpen(false)} onSubmit={value => create.mutate(value)} />
  </div>;
}
