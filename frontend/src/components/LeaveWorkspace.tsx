import { HistoryOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Pagination, Select, Space, Spin, Table as AntTable, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import type { TableProps } from "antd";
import { ApiError, errorMessage } from "../api/client";
import { leaveApi } from "../api/leave";
import type { LeaveBalanceAction, LeaveBalanceView, LeaveEmployee, LeaveEntitlementCalculation, LeaveLedgerEntry, LeavePolicyHeader, LeavePolicyVersion, LeaveStatus, LeaveTypeHeader, LeaveTypeVersion, LeaveUnit, WorkingCondition } from "../api/leave";
import type { AuthUser } from "../api/hrtp";
import { LeaveRequestsWorkspace } from "./LeaveRequestsWorkspace";
import { TechnicalDetails } from "./TechnicalDetails";

const { Title, Paragraph, Text } = Typography;
const required = [{ required: true, whitespace: true, message: "Trường này là bắt buộc." }];
const statusOptions = [
  { value: "SIMULATION", label: "Mô phỏng" },
  { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" },
];
const conditionOptions = [
  { value: "NORMAL", label: "Điều kiện bình thường" },
  { value: "HAZARDOUS", label: "Nặng nhọc, độc hại, nguy hiểm" },
  { value: "EXTREME", label: "Đặc biệt nặng nhọc, độc hại, nguy hiểm" },
];

function LeaveTableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Dữ liệu nghỉ và quỹ phép" />;
}

function Table<RecordType extends object>(props: TableProps<RecordType>) {
  return <AntTable<RecordType> {...props} components={{ body: { wrapper: LeaveTableBody } }} />;
}

function vietnamToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value));
}

function dateInRange(version: { effectiveFrom: string; effectiveTo: string | null }, asOf: string): boolean {
  return version.effectiveFrom <= asOf && (!version.effectiveTo || version.effectiveTo >= asOf);
}

function activeVersion<T extends { effectiveFrom: string; effectiveTo: string | null }>(versions: T[], asOf: string): T | undefined {
  return versions.find((version) => dateInRange(version, asOf));
}

function statusTag(status: LeaveStatus) {
  return <Tag color={status === "BUSINESS_CONFIRMED" ? "success" : "warning"}>{status === "BUSINESS_CONFIRMED" ? "Đã xác nhận" : "Mô phỏng"}</Tag>;
}

function decimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const ledgerKindLabels: Record<string, string> = {
  ENTITLEMENT: "Cấp phép năm",
  RECALCULATION: "Tính lại quỹ phép",
  ADJUSTMENT: "Điều chỉnh quỹ",
  CARRY_IN: "Nhận phép chuyển",
  CARRY_OUT: "Chuyển phép sang năm sau",
  ADVANCE_IN: "Ghi nhận phép ứng",
  ADVANCE_OUT: "Khấu trừ phép đã ứng",
  USE: "Trừ quỹ theo đơn nghỉ",
  REFUND: "Hoàn quỹ từ đơn nghỉ",
  EXPIRE: "Hết hạn",
  RECONCILIATION: "Đối soát",
};
const ledgerBucketLabels: Record<string, string> = {
  ANNUAL: "Phép năm",
  CARRY: "Phép chuyển",
  ADVANCE: "Phép ứng",
};
const workingConditionLabels: Record<WorkingCondition, string> = {
  NORMAL: "Điều kiện bình thường",
  HAZARDOUS: "Nặng nhọc, độc hại, nguy hiểm",
  EXTREME: "Đặc biệt nặng nhọc, độc hại, nguy hiểm",
};

function TechnicalJson({ title, value }: { title: string; value: unknown }) {
  return <TechnicalDetails title={title}><pre>{JSON.stringify(value, null, 2)}</pre></TechnicalDetails>;
}

function ledgerLabel(value: string, labels: Record<string, string>, rawTitle: string) {
  const label = labels[value];
  return label ?? <><Text type="secondary">Chưa phân loại</Text><TechnicalJson title={rawTitle} value={value} /></>;
}

function requestReference(entry: LeaveLedgerEntry) {
  const snapshotRequestId = typeof entry.operation.snapshot.requestId === "string" ? entry.operation.snapshot.requestId : undefined;
  const referenceRequestId = /^Đơn nghỉ\s+(.+)$/u.exec(entry.operation.reference)?.[1];
  const requestId = snapshotRequestId ?? referenceRequestId;
  if (!requestId) return entry.operation.reference;
  return <><Text>Đơn nghỉ</Text><TechnicalJson title="Mã đơn nghỉ" value={{ requestId }} /></>;
}

function CalculationView({ calculation }: { calculation: LeaveEntitlementCalculation | null }) {
  if (!calculation) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lần tính quỹ" />;
  const rounding = calculation.precision === "HALF_UP_2_DECIMALS" ? "Làm tròn nửa lên đến 2 chữ số thập phân" : calculation.precision;
  return <section className="leave-calculation">
    <Title level={3}>Cách tính quỹ</Title>
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
      <Descriptions.Item label="Năm quỹ">{calculation.year}</Descriptions.Item>
      <Descriptions.Item label="Ngày tính">{calculation.effectiveDate}</Descriptions.Item>
      <Descriptions.Item label="Điều kiện làm việc">{workingConditionLabels[calculation.workingCondition] ?? calculation.workingCondition}</Descriptions.Item>
      <Descriptions.Item label="Tháng đủ điều kiện">{calculation.eligibleMonths.length}</Descriptions.Item>
      <Descriptions.Item label="Tổng ngày phép">{decimal(calculation.entitledDays)}</Descriptions.Item>
      <Descriptions.Item label="Cách làm tròn">{rounding || "—"}</Descriptions.Item>
      <Descriptions.Item label="Thời điểm chốt thâm niên">{calculation.serviceAsOf}</Descriptions.Item>
      <Descriptions.Item label="Thâm niên đã hoàn thành">{calculation.serviceYears} năm</Descriptions.Item>
      <Descriptions.Item label="Cộng thâm niên">{calculation.seniorityDays} ngày/năm</Descriptions.Item>
    </Descriptions>
    <Title level={4}>Các tháng được ghi nhận</Title>
    <Table rowKey={(row) => String(calculation.year) + "-" + row.month + "-" + row.policyVersionId} size="small" pagination={false} scroll={{ x: 880 }} dataSource={calculation.months} locale={{ emptyText: <Empty description="Chưa có tháng đủ điều kiện được ghi nhận" /> }} columns={[
      { title: "Tháng", width: 100, render: (_, row) => "Tháng " + row.month + "/" + calculation.year },
      { title: "Đủ điều kiện", width: 150, render: (_, row) => calculation.eligibleMonths.includes(row.month) ? "Đã xác nhận" : "Không có trong dữ liệu tháng đủ điều kiện" },
      { title: "Định mức năm", dataIndex: "baseDays", width: 125, align: "right", render: (value) => decimal(String(value)) },
      { title: "Thâm niên", dataIndex: "seniorityDays", width: 115, align: "right", render: (value) => String(value) + " ngày/năm" },
      { title: "Quyết định / tham chiếu", dataIndex: "decisionReference", width: 240, render: (value) => value || "—" },
    ]} />
    <TechnicalJson title="Dữ liệu tính quỹ gốc" value={calculation} />
  </section>;
}

function formError(error: unknown) {
  if (!error) return null;
  const conflict = error instanceof ApiError && error.status === 409;
  return <Alert type={conflict ? "warning" : "error"} showIcon message={conflict ? "Dữ liệu đã thay đổi" : "Không thể lưu thay đổi"} description={conflict ? "Bản ghi đã được cập nhật bởi thao tác khác. Hãy tải lại dữ liệu, kiểm tra lịch sử và thực hiện lại." : errorMessage(error)} />;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function useStableRequestId() {
  const ref = useRef<{ key: string; value: string } | undefined>(undefined);
  return (payload: unknown) => {
    const key = JSON.stringify(payload);
    if (!ref.current || ref.current.key !== key) ref.current = { key, value: newRequestId() };
    return ref.current.value;
  };
}
function successorEffectiveFrom(versions: { effectiveFrom: string }[]): string {
  const latest = versions.reduce((current, version) => version.effectiveFrom > current ? version.effectiveFrom : current, "0000-01-01");
  const following = new Date(`${latest}T00:00:00.000Z`);
  following.setUTCDate(following.getUTCDate() + 1);
  const candidate = following.toISOString().slice(0, 10);
  return candidate > vietnamToday() ? candidate : vietnamToday();
}

function defaultFundEffectiveDate(balance: LeaveBalanceView, kind: "recalculate" | "adjust" | "carry" | "advance"): string {
  const fundYear = kind === "carry" ? balance.year + 1 : balance.year;
  const firstDay = `${fundYear}-01-01`;
  let lastDay = `${fundYear}-12-31`;
  const today = vietnamToday();
  if (lastDay > today) lastDay = today;
  if ((kind === "recalculate" || kind === "adjust") && balance.employee.terminationDate && balance.employee.terminationDate < lastDay) lastDay = balance.employee.terminationDate;
  const employmentStart = (kind === "recalculate" || kind === "adjust") && balance.employee.hireDate > firstDay ? balance.employee.hireDate : firstDay;
  if (employmentStart > lastDay) return lastDay;
  return today < employmentStart ? employmentStart : today > lastDay ? lastDay : today;
}

interface TypeValues {
  orgUnitId?: string;
  code?: string;
  name: string;
  active: boolean;
  isPaid: boolean;
  countsAsWorkday: boolean;
  deductsAnnualQuota: boolean;
  siPaid: boolean;
  requiresDocument: boolean;
  maxDays?: string;
  attendanceSymbol: string;
  status: LeaveStatus;
  decisionReference: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

function TypeEditor({ item, units, open, onClose }: { item: LeaveTypeHeader | null; units: LeaveUnit[]; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<TypeValues>();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: TypeValues) => {
      const versionPayload = {
        name: values.name.trim(),
        active: values.active,
        isPaid: values.isPaid,
        countsAsWorkday: values.countsAsWorkday,
        deductsAnnualQuota: values.deductsAnnualQuota,
        siPaid: values.siPaid,
        requiresDocument: values.requiresDocument,
        maxDays: values.maxDays?.trim() || null,
        attendanceSymbol: values.attendanceSymbol.trim().toUpperCase(),
        decisionReference: values.decisionReference.trim(),
        reason: values.reason.trim(),
        status: values.status,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo || null,
      };
      return item
        ? leaveApi.createTypeVersion(item.id, { ...versionPayload, revision: item.revision })
        : leaveApi.createType({ ...versionPayload, orgUnitId: values.orgUnitId!, code: values.code!.trim().toUpperCase() });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["leave", "types"] }); onClose(); },
  });
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (!open) return;
    resetMutation();
    form.resetFields();
    form.setFieldsValue(item ? {
      ...item.versions[0],
      maxDays: item.versions[0]?.maxDays ?? undefined,
      effectiveFrom: successorEffectiveFrom(item.versions),
      effectiveTo: undefined,
    } : {
      active: true, isPaid: true, countsAsWorkday: true, deductsAnnualQuota: false, siPaid: false, requiresDocument: false,
      status: "SIMULATION", effectiveFrom: vietnamToday(),
    });
  }, [form, item, open, resetMutation]);
  return <Modal className="leave-editor" title={item ? `Thêm phiên bản · ${item.code}` : "Tạo loại nghỉ"} open={open} onCancel={onClose} footer={null} width={880} destroyOnHidden>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={(values) => mutation.mutate(values)}>
      {item && <Alert type="info" showIcon message={`Phiên bản kế tiếp của ${item.code}`} description="Hệ thống bảo toàn lịch sử; thời điểm hiệu lực không được chồng lấn phiên bản có trước." />}
      <div className="form-grid leave-form-grid">
        {!item && <Form.Item name="orgUnitId" label="Đơn vị áp dụng" rules={required}><Select showSearch optionFilterProp="label" options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} /></Form.Item>}
        {!item && <Form.Item name="code" label="Mã loại nghỉ" rules={[...required, { pattern: /^[A-Za-z][A-Za-z0-9_]{1,31}$/, message: "Bắt đầu bằng chữ; dùng 2–32 ký tự chữ, số hoặc gạch dưới." }]}><Input maxLength={32} /></Form.Item>}
        <Form.Item name="name" label="Tên loại nghỉ" rules={required}><Input maxLength={150} /></Form.Item>
        <Form.Item name="attendanceSymbol" label="Ký hiệu chấm công" rules={required}><Input maxLength={12} /></Form.Item>
        <Form.Item name="maxDays" label="Số ngày tối đa"><Input inputMode="decimal" placeholder="Để trống nếu không giới hạn" /></Form.Item>
        <Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={required}><Input type="date" /></Form.Item>
        <Form.Item name="effectiveTo" label="Hiệu lực đến"><Input type="date" /></Form.Item>
        <Form.Item name="status" label="Trạng thái nghiệp vụ" rules={required}><Select options={statusOptions} /></Form.Item>
      </div>
      <section className="leave-switches" aria-label="Thuộc tính loại nghỉ">
        <Form.Item name="active" valuePropName="checked"><Checkbox>Đang áp dụng</Checkbox></Form.Item>
        <Form.Item name="isPaid" valuePropName="checked"><Checkbox>Nghỉ hưởng lương</Checkbox></Form.Item>
        <Form.Item name="countsAsWorkday" valuePropName="checked"><Checkbox>Tính ngày công</Checkbox></Form.Item>
        <Form.Item name="deductsAnnualQuota" valuePropName="checked"><Checkbox>Trừ quỹ phép năm</Checkbox></Form.Item>
        <Form.Item name="siPaid" valuePropName="checked"><Checkbox>Chi trả BHXH</Checkbox></Form.Item>
        <Form.Item name="requiresDocument" valuePropName="checked"><Checkbox>Yêu cầu chứng từ</Checkbox></Form.Item>
      </section>
      <Form.Item name="decisionReference" label="Số quyết định / tham chiếu" rules={required}><Input maxLength={500} /></Form.Item>
      <Form.Item name="reason" label="Lý do" rules={required}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      {formError(mutation.error)}
      <div className="modal-actions"><Space><Button onClick={onClose}>Hủy</Button><Button htmlType="submit" type="primary" loading={mutation.isPending}>{item ? "Tạo phiên bản" : "Tạo loại nghỉ"}</Button></Space></div>
    </Form>
  </Modal>;
}

function TypeHistory({ item, open, onClose }: { item: LeaveTypeHeader | null; open: boolean; onClose: () => void }) {
  return <Drawer className="leave-drawer" title={item ? `Lịch sử loại nghỉ · ${item.code}` : "Lịch sử loại nghỉ"} open={open} onClose={onClose} width={880}>
    {item && <Table<LeaveTypeVersion> rowKey="id" size="small" scroll={{ x: 1000 }} pagination={false} dataSource={item.versions} locale={{ emptyText: <Empty description="Chưa có phiên bản" /> }} columns={[
      { title: "Hiệu lực", width: 190, render: (_, row) => <>{row.effectiveFrom}<br /><Text type="secondary">{row.effectiveTo ?? "Không xác định"}</Text></> },
      { title: "Tên / ký hiệu", render: (_, row) => <><Text strong>{row.name}</Text><small className="table-subtext">{row.attendanceSymbol}</small></> },
      { title: "Nghiệp vụ", width: 170, render: (_, row) => <Space size={[3, 3]} wrap>{statusTag(row.status)}{row.active ? <Tag color="success">Áp dụng</Tag> : <Tag>Ngừng</Tag>}{row.isPaid && <Tag>Có lương</Tag>}{row.deductsAnnualQuota && <Tag color="processing">Trừ phép</Tag>}</Space> },
      { title: "Tham chiếu / lý do", width: 260, render: (_, row) => <><Text>{row.decisionReference}</Text><small className="table-subtext">{row.reason}</small><small className="table-subtext">{row.createdBy?.displayName ?? "Không rõ người tạo"} · {dateTime(row.createdAt)}</small></> },
    ]} />}
  </Drawer>;
}

interface PolicyValues {
  orgUnitId?: string;
  name: string;
  normalDays: number;
  hazardousDays: number;
  extremeDays: number;
  carryLimitDays: string;
  carryExpiryMonth: number;
  carryExpiryDay: number;
  advanceLimitDays: string;
  status: LeaveStatus;
  decisionReference: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

function PolicyEditor({ item, units, open, onClose }: { item: LeavePolicyHeader | null; units: LeaveUnit[]; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<PolicyValues>();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: PolicyValues) => {
      if (!(values.normalDays <= values.hazardousDays && values.hazardousDays <= values.extremeDays)) throw new Error("Số ngày phép phải tăng dần: bình thường ≤ nặng nhọc ≤ đặc biệt nặng nhọc.");
      const versionPayload = { name: values.name.trim(), normalDays: values.normalDays, hazardousDays: values.hazardousDays, extremeDays: values.extremeDays, carryLimitDays: values.carryLimitDays.trim(), carryExpiryMonth: values.carryExpiryMonth, carryExpiryDay: values.carryExpiryDay, advanceLimitDays: values.advanceLimitDays.trim(), status: values.status, decisionReference: values.decisionReference.trim(), reason: values.reason.trim(), effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo || null };
      return item ? leaveApi.createPolicyVersion(item.id, { ...versionPayload, revision: item.revision }) : leaveApi.createPolicy({ ...versionPayload, orgUnitId: values.orgUnitId! });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["leave", "policies"] }); onClose(); },
  });
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (!open) return;
    resetMutation();
    form.resetFields();
    form.setFieldsValue(item ? { ...item.versions[0], effectiveFrom: successorEffectiveFrom(item.versions), effectiveTo: undefined } : {
      normalDays: 12, hazardousDays: 14, extremeDays: 16, carryLimitDays: "5", carryExpiryMonth: 3, carryExpiryDay: 31, advanceLimitDays: "3", status: "SIMULATION", effectiveFrom: vietnamToday(),
    });
  }, [form, item, open, resetMutation]);
  return <Modal className="leave-editor" title={item ? `Thêm phiên bản · ${item.orgUnitName}` : "Tạo chính sách phép năm"} open={open} onCancel={onClose} footer={null} width={880} destroyOnHidden>
    <Form form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={(values) => mutation.mutate(values)}>
      {item && <Alert type="info" showIcon message="Tạo chính sách kế tiếp" description="Phiên bản đang có vẫn được lưu để đối chiếu và truy vết." />}
      <div className="form-grid leave-form-grid">
        {!item && <Form.Item name="orgUnitId" label="Đơn vị áp dụng" rules={required}><Select showSearch optionFilterProp="label" options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} /></Form.Item>}
        <Form.Item name="name" label="Tên chính sách" rules={required}><Input maxLength={150} /></Form.Item>
        <Form.Item name="normalDays" label="Ngày phép điều kiện bình thường" rules={[{ required: true, type: "number", min: 12, max: 366, message: "Từ 12 đến 366 ngày." }]}><InputNumber min={12} max={366} precision={0} /></Form.Item>
        <Form.Item name="hazardousDays" label="Ngày phép điều kiện nặng nhọc" rules={[{ required: true, type: "number", min: 14, max: 366, message: "Từ 14 đến 366 ngày." }]}><InputNumber min={14} max={366} precision={0} /></Form.Item>
        <Form.Item name="extremeDays" label="Ngày phép điều kiện đặc biệt" rules={[{ required: true, type: "number", min: 16, max: 366, message: "Từ 16 đến 366 ngày." }]}><InputNumber min={16} max={366} precision={0} /></Form.Item>
        <Form.Item name="carryLimitDays" label="Tối đa chuyển phép" rules={required}><Input inputMode="decimal" /></Form.Item>
        <Form.Item name="carryExpiryMonth" label="Tháng hết hạn phép chuyển" rules={[{ required: true, type: "number", min: 1, max: 12, message: "Chọn tháng từ 1 đến 12." }]}><InputNumber min={1} max={12} precision={0} /></Form.Item>
        <Form.Item name="carryExpiryDay" label="Ngày hết hạn phép chuyển" rules={[{ required: true, type: "number", min: 1, max: 31, message: "Chọn ngày từ 1 đến 31." }]}><InputNumber min={1} max={31} precision={0} /></Form.Item>
        <Form.Item name="advanceLimitDays" label="Tối đa ứng trước" rules={required}><Input inputMode="decimal" /></Form.Item>
        <Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={required}><Input type="date" /></Form.Item>
        <Form.Item name="effectiveTo" label="Hiệu lực đến"><Input type="date" /></Form.Item>
        <Form.Item name="status" label="Trạng thái nghiệp vụ" rules={required}><Select options={statusOptions} /></Form.Item>
      </div>
      <Form.Item name="decisionReference" label="Số quyết định / tham chiếu" rules={required}><Input maxLength={500} /></Form.Item>
      <Form.Item name="reason" label="Lý do" rules={required}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      {formError(mutation.error)}
      <div className="modal-actions"><Space><Button onClick={onClose}>Hủy</Button><Button htmlType="submit" type="primary" loading={mutation.isPending}>{item ? "Tạo phiên bản" : "Tạo chính sách"}</Button></Space></div>
    </Form>
  </Modal>;
}

function PolicyHistory({ item, open, onClose }: { item: LeavePolicyHeader | null; open: boolean; onClose: () => void }) {
  return <Drawer className="leave-drawer" title={item ? `Lịch sử chính sách · ${item.orgUnitName}` : "Lịch sử chính sách"} open={open} onClose={onClose} width={980}>
    {item && <Table<LeavePolicyVersion> rowKey="id" size="small" scroll={{ x: 1100 }} pagination={false} dataSource={item.versions} locale={{ emptyText: <Empty description="Chưa có phiên bản" /> }} columns={[
      { title: "Hiệu lực", width: 190, render: (_, row) => <>{row.effectiveFrom}<br /><Text type="secondary">{row.effectiveTo ?? "Không xác định"}</Text></> },
      { title: "Chính sách", render: (_, row) => <><Text strong>{row.name}</Text><small className="table-subtext">Bình thường {row.normalDays} · Nặng nhọc {row.hazardousDays} · Đặc biệt {row.extremeDays}</small></> },
      { title: "Chuyển / ứng", width: 200, render: (_, row) => <><Text>Chuyển tối đa {decimal(row.carryLimitDays)} ngày</Text><small className="table-subtext">Hết hạn {row.carryExpiryDay}/{row.carryExpiryMonth} · Ứng {decimal(row.advanceLimitDays)} ngày</small></> },
      { title: "Xác nhận", width: 270, render: (_, row) => <>{statusTag(row.status)}<small className="table-subtext">{row.decisionReference}</small><small className="table-subtext">{row.reason}</small><small className="table-subtext">{row.createdBy?.displayName ?? "Không rõ người tạo"} · {dateTime(row.createdAt)}</small></> },
    ]} />}
  </Drawer>;
}

function CatalogWorkspace({ canConfigure }: { canConfigure: boolean }) {
  const [tab, setTab] = useState("types");
  const [asOf, setAsOf] = useState(vietnamToday());
  const [search, setSearch] = useState("");
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const [typeEditor, setTypeEditor] = useState<LeaveTypeHeader | null | undefined>(undefined);
  const [policyEditor, setPolicyEditor] = useState<LeavePolicyHeader | null | undefined>(undefined);
  const [typeHistory, setTypeHistory] = useState<LeaveTypeHeader | null>(null);
  const [policyHistory, setPolicyHistory] = useState<LeavePolicyHeader | null>(null);
  const context = useQuery({ queryKey: ["leave", "context"], queryFn: leaveApi.context });
  const filters = { asOf, search, orgUnitId };
  const types = useQuery({ queryKey: ["leave", "types", filters], queryFn: () => leaveApi.types(filters) });
  const policies = useQuery({ queryKey: ["leave", "policies", filters], queryFn: () => leaveApi.policies(filters) });
  const unitOptions = context.data?.units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }));
  const editableUnits = context.data?.managementUnits ?? [];
  const editableUnitIds = new Set(editableUnits.map((unit) => unit.id));
  const typeColumns: ColumnsType<LeaveTypeHeader> = [
    { title: "Mã", dataIndex: "code", width: 120, render: (value) => <Text strong>{value}</Text> },
    { title: "Loại nghỉ", render: (_, row) => { const current = activeVersion(row.versions, asOf); return current ? <><Text>{current.name}</Text><small className="table-subtext">{current.attendanceSymbol} · {current.isPaid ? "Hưởng lương" : "Không hưởng lương"}{current.deductsAnnualQuota ? " · Trừ phép năm" : ""}</small></> : <Text type="secondary">Không hiệu lực tại ngày đã chọn</Text>; } },
    { title: "Đơn vị", width: 190, render: (_, row) => <>{row.orgUnitName}<small className="table-subtext">{row.orgUnitCode}</small></> },
    { title: "Trạng thái", width: 145, render: (_, row) => { const current = activeVersion(row.versions, asOf); return current ? statusTag(current.status) : "—"; } },
    { title: "Phiên bản", dataIndex: "revision", width: 90, align: "right" },
    { title: "Thao tác", width: 220, fixed: "right", render: (_, row) => <Space size="small"><Button type="link" icon={<HistoryOutlined />} onClick={() => setTypeHistory(row)}>Lịch sử</Button>{canConfigure && editableUnitIds.has(row.orgUnitId) && <Button type="link" onClick={() => setTypeEditor(row)}>Phiên bản mới</Button>}</Space> },
  ];
  const policyColumns: ColumnsType<LeavePolicyHeader> = [
    { title: "Đơn vị", width: 190, render: (_, row) => <>{row.orgUnitName}<small className="table-subtext">{row.orgUnitCode}</small></> },
    { title: "Chính sách hiệu lực", render: (_, row) => { const current = activeVersion(row.versions, asOf); return current ? <><Text>{current.name}</Text><small className="table-subtext">{current.normalDays} / {current.hazardousDays} / {current.extremeDays} ngày phép</small></> : <Text type="secondary">Không hiệu lực tại ngày đã chọn</Text>; } },
    { title: "Chuyển / ứng", width: 220, render: (_, row) => { const current = activeVersion(row.versions, asOf); return current ? <><Text>Chuyển {decimal(current.carryLimitDays)} ngày</Text><small className="table-subtext">Hết hạn {current.carryExpiryDay}/{current.carryExpiryMonth} · Ứng {decimal(current.advanceLimitDays)} ngày</small></> : "—"; } },
    { title: "Trạng thái", width: 145, render: (_, row) => { const current = activeVersion(row.versions, asOf); return current ? statusTag(current.status) : "—"; } },
    { title: "Phiên bản", dataIndex: "revision", width: 90, align: "right" },
    { title: "Thao tác", width: 220, fixed: "right", render: (_, row) => <Space size="small"><Button type="link" icon={<HistoryOutlined />} onClick={() => setPolicyHistory(row)}>Lịch sử</Button>{canConfigure && editableUnitIds.has(row.orgUnitId) && <Button type="link" onClick={() => setPolicyEditor(row)}>Phiên bản mới</Button>}</Space> },
  ];
  const filterBar = <section className="leave-filters" aria-label="Bộ lọc cấu hình nghỉ phép">
    <Input.Search placeholder="Tìm mã hoặc tên" allowClear value={search} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => setSearch(value.trim())} enterButton={<SearchOutlined />} />
    <Select aria-label="Lọc theo đơn vị" allowClear placeholder="Tất cả đơn vị trong phạm vi" value={orgUnitId} options={unitOptions} loading={context.isLoading} onChange={setOrgUnitId} />
    <label>Áp dụng tại ngày<Input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value || vietnamToday())} /></label>
  </section>;
  const typeContent = <>
    <div className="leave-tab-heading"><div><Title level={2}>Loại nghỉ</Title><Paragraph type="secondary">Theo dõi phiên bản theo ngày hiệu lực. “Mô phỏng” chưa phải xác nhận nghiệp vụ.</Paragraph></div>{canConfigure && <Button type="primary" icon={<PlusOutlined />} onClick={() => setTypeEditor(null)}>Tạo loại nghỉ</Button>}</div>
    {filterBar}
    {types.isError ? <Alert type="error" showIcon message="Không tải được loại nghỉ" description={errorMessage(types.error)} /> : <section className="panel table-panel"><Table rowKey="id" loading={types.isLoading} dataSource={types.data?.items ?? []} columns={typeColumns} pagination={false} scroll={{ x: 980 }} locale={{ emptyText: <Empty description="Không có loại nghỉ trong phạm vi hoặc tại ngày đã chọn" /> }} /></section>}
  </>;
  const policyContent = <>
    <div className="leave-tab-heading"><div><Title level={2}>Chính sách phép năm</Title><Paragraph type="secondary">Quy định định mức, chuyển phép và ứng trước theo đơn vị, giữ nguyên lịch sử mỗi lần thay đổi.</Paragraph></div>{canConfigure && <Button type="primary" icon={<PlusOutlined />} onClick={() => setPolicyEditor(null)}>Tạo chính sách</Button>}</div>
    {filterBar}
    {policies.isError ? <Alert type="error" showIcon message="Không tải được chính sách phép năm" description={errorMessage(policies.error)} /> : <section className="panel table-panel"><Table rowKey="id" loading={policies.isLoading} dataSource={policies.data?.items ?? []} columns={policyColumns} pagination={false} scroll={{ x: 1060 }} locale={{ emptyText: <Empty description="Không có chính sách trong phạm vi hoặc tại ngày đã chọn" /> }} /></section>}
  </>;
  return <><Tabs activeKey={tab} onChange={setTab} items={[{ key: "types", label: "Loại nghỉ", children: typeContent }, { key: "policies", label: "Chính sách", children: policyContent }]} />
    {typeEditor !== undefined && <TypeEditor item={typeEditor} units={editableUnits} open onClose={() => setTypeEditor(undefined)} />}
    {policyEditor !== undefined && <PolicyEditor item={policyEditor} units={editableUnits} open onClose={() => setPolicyEditor(undefined)} />}
    <TypeHistory item={typeHistory} open={Boolean(typeHistory)} onClose={() => setTypeHistory(null)} />
    <PolicyHistory item={policyHistory} open={Boolean(policyHistory)} onClose={() => setPolicyHistory(null)} />
  </>;
}

function EmployeePicker({ year, units, onChoose, onClose }: { year: number; units: LeaveUnit[]; onChoose: (employee: LeaveEmployee) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const employees = useQuery({ queryKey: ["leave", "employees", year, search, orgUnitId], queryFn: () => leaveApi.employees({ year, search, orgUnitId, page: 1, pageSize: 20 }) });
  return <Modal className="leave-picker" title={`Chọn nhân sự để lập quỹ phép năm ${year}`} open onCancel={onClose} footer={null} width={860} destroyOnHidden>
    <section className="leave-filters leave-picker-filters"><Input.Search placeholder="Tìm mã hoặc họ tên" allowClear value={search} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => setSearch(value.trim())} enterButton={<SearchOutlined />} /><Select aria-label="Lọc đơn vị nhân sự" allowClear placeholder="Tất cả đơn vị" value={orgUnitId} onChange={setOrgUnitId} options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} /></section>
    {employees.isError ? <Alert type="error" showIcon message="Không tải được danh sách nhân sự" description={errorMessage(employees.error)} /> : <Table<LeaveEmployee> rowKey="id" size="small" loading={employees.isLoading} pagination={false} scroll={{ x: 760 }} dataSource={employees.data?.items ?? []} locale={{ emptyText: <Empty description="Không có nhân sự phù hợp" /> }} columns={[
      { title: "Mã", dataIndex: "code", width: 120 }, { title: "Họ và tên", dataIndex: "fullName" }, { title: "Đơn vị", render: (_, row) => <>{row.orgUnit.name}<small className="table-subtext">{row.orgUnit.code}</small></> }, { title: "Ngày vào làm", dataIndex: "hireDate", width: 125 }, { title: "Thao tác", width: 110, render: (_, row) => <Button type="link" onClick={() => onChoose(row)}>Chọn</Button> },
    ]} />}
  </Modal>;
}

interface FundActionValues { effectiveDate: string; reason: string; reference: string; days?: string; workingCondition?: WorkingCondition; eligibleMonths?: number[]; qualifyingMonthsConfirmed?: boolean; }
function FundActionModal({ kind, balance, onClose }: { kind: "recalculate" | "adjust" | "carry" | "advance"; balance: LeaveBalanceView; onClose: () => void }) {
  const [form] = Form.useForm<FundActionValues>();
  const client = useQueryClient();
  const stableRequestId = useStableRequestId();
  const target = useQuery({ queryKey: ["leave", "balance", balance.employee.id, balance.year + 1], queryFn: () => leaveApi.balance(balance.employee.id, balance.year + 1), enabled: kind === "carry" || kind === "advance" });
  const title = kind === "recalculate" ? "Tính lại quỹ phép" : kind === "adjust" ? "Điều chỉnh quỹ phép" : kind === "carry" ? "Chuyển phép sang năm sau" : "Ứng phép năm sau";
  const mutation = useMutation({
    mutationFn: (values: FundActionValues) => {
      const common: Omit<LeaveBalanceAction, "requestId"> = { revision: balance.revision, effectiveDate: values.effectiveDate, reason: values.reason.trim(), reference: values.reference.trim() };
      const base = { ...common, requestId: stableRequestId({ kind, employeeId: balance.employee.id, year: balance.year, ...common, days: values.days?.trim(), workingCondition: values.workingCondition, eligibleMonths: values.eligibleMonths, targetRevision: kind === "carry" || kind === "advance" ? target.data?.balance.revision ?? 0 : undefined }) };
      if (kind === "recalculate") return leaveApi.recalculate(balance.employee.id, balance.year, { ...base, workingCondition: values.workingCondition!, eligibleMonths: values.eligibleMonths ?? [] });
      if (kind === "adjust") return leaveApi.adjust(balance.employee.id, balance.year, { ...base, days: values.days!.trim() });
      const transfer = { ...base, days: values.days!.trim(), targetRevision: target.data?.balance.revision ?? 0 };
      return kind === "carry" ? leaveApi.carry(balance.employee.id, balance.year, transfer) : leaveApi.advance(balance.employee.id, balance.year, transfer);
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["leave", "balances"] }); void client.invalidateQueries({ queryKey: ["leave", "balance"] }); onClose(); },
  });
  const isTransfer = kind === "carry" || kind === "advance";
  const defaultEffectiveDate = defaultFundEffectiveDate(balance, kind);
  const effectiveDateRule = kind === "carry"
    ? `Ngày hiệu lực phải thuộc năm đích ${balance.year + 1}, không sau hôm nay và không quá hạn chuyển phép đã cấu hình.`
    : kind === "advance"
      ? `Ngày hiệu lực phải thuộc năm quỹ nguồn ${balance.year} và không sau hôm nay.`
      : `Ngày hiệu lực phải thuộc năm quỹ ${balance.year}, không sau hôm nay và trong thời gian làm việc phù hợp.`;
  return <Modal className="leave-editor" title={title} open onCancel={onClose} footer={null} width={720} destroyOnHidden>
    <Form form={form} initialValues={{ effectiveDate: defaultEffectiveDate, workingCondition: "NORMAL", eligibleMonths: [], qualifyingMonthsConfirmed: false }} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={(values) => mutation.mutate(values)}>
      {kind === "recalculate" && <Alert type="info" showIcon message="Xác nhận tháng đủ điều kiện" description="Kế toán phải tự xác nhận các tháng đủ điều kiện 50%; dữ liệu chấm công chưa đủ để hệ thống tự suy ra." />}
      {isTransfer && <Alert type="info" showIcon message={`Quỹ năm ${balance.year + 1}`} description={target.isLoading ? "Đang tải số phiên bản quỹ đích…" : `Phiên bản đích hiện tại: ${target.data?.balance.revision ?? 0}. Giao dịch sẽ kiểm tra cả hai quỹ khi lưu.`} />}
      <Alert type="info" showIcon message="Quy tắc ngày hiệu lực" description={effectiveDateRule} />
      <div className="form-grid leave-form-grid">
        <Form.Item name="effectiveDate" label="Ngày hiệu lực" rules={required}><Input type="date" /></Form.Item>
        {kind === "recalculate" && <Form.Item name="workingCondition" label="Điều kiện làm việc" rules={required}><Select options={conditionOptions} /></Form.Item>}
        {(kind === "adjust" || isTransfer) && <Form.Item name="days" label={kind === "adjust" ? "Số ngày điều chỉnh (có thể âm)" : "Số ngày"} rules={[...required, { pattern: kind === "adjust" ? /^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/ : /^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/, message: "Nhập số ngày hợp lệ, tối đa 2 chữ số thập phân." }]}><Input inputMode="decimal" /></Form.Item>}
      </div>
      {kind === "recalculate" && <>
        <Form.Item name="eligibleMonths" label="Các tháng đủ điều kiện (có thể không có tháng nào)"><Checkbox.Group className="leave-months" options={Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: `Tháng ${index + 1}` }))} /></Form.Item>
        <Form.Item name="qualifyingMonthsConfirmed" valuePropName="checked" rules={[{ validator: (_, checked) => checked ? Promise.resolve() : Promise.reject(new Error("Xác nhận danh sách tháng đủ điều kiện, kể cả khi để trống.")) }]}><Checkbox>Tôi xác nhận danh sách tháng trên, kể cả khi không có tháng nào đủ điều kiện 50%.</Checkbox></Form.Item>
      </>}
      <Form.Item name="reference" label="Số quyết định / tham chiếu" rules={required}><Input maxLength={500} /></Form.Item>
      <Form.Item name="reason" label="Lý do" rules={required}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      {formError(mutation.error)}
      <div className="modal-actions"><Space><Button onClick={onClose}>Hủy</Button><Button htmlType="submit" type="primary" loading={mutation.isPending} disabled={isTransfer && target.isLoading}>{title}</Button></Space></div>
    </Form>
  </Modal>;
}

function BalanceDrawer({ employeeId, year, asOf, canManage, onClose }: { employeeId: string; year: number; asOf: string; canManage: boolean; onClose: () => void }) {
  const [action, setAction] = useState<"recalculate" | "adjust" | "carry" | "advance" | null>(null);
  const detail = useQuery({ queryKey: ["leave", "balance", employeeId, year, asOf], queryFn: () => leaveApi.balance(employeeId, year, asOf) });
  const balance = detail.data?.balance;
  const ledgerColumns: ColumnsType<LeaveLedgerEntry> = [
    { title: "Ngày", dataIndex: ["operation", "effectiveDate"], width: 105 },
    { title: "Nghiệp vụ", dataIndex: "kind", width: 180, render: (value) => ledgerLabel(value, ledgerKindLabels, "Mã nghiệp vụ gốc") },
    { title: "Quỹ", dataIndex: "bucket", width: 130, render: (value) => ledgerLabel(value, ledgerBucketLabels, "Mã quỹ gốc") },
    { title: "Số ngày", dataIndex: "days", align: "right", width: 110, render: (value) => <span className="numeric">{decimal(value)}</span> },
    { title: "Hết hạn", dataIndex: "expiresAt", width: 110, render: (value) => value ?? "—" },
    { title: "Hồ sơ / tham chiếu", width: 240, render: (_, row) => <><Text>{row.operation.actor.displayName}</Text><small className="table-subtext">{requestReference(row)}</small></> },
    { title: "Lý do", dataIndex: ["operation", "reason"], width: 240, ellipsis: true },
  ];
  return <><Drawer className="leave-drawer" title={"Quỹ phép năm " + year} open onClose={onClose} width={1040} extra={canManage && balance ? <Space wrap><Button onClick={() => setAction("recalculate")}>Tính lại</Button><Button onClick={() => setAction("adjust")}>Điều chỉnh</Button><Button onClick={() => setAction("carry")}>Chuyển phép</Button><Button type="primary" onClick={() => setAction("advance")}>Ứng phép</Button></Space> : undefined}>
    {detail.isLoading ? <div className="workspace-loading"><Spin /> Đang tải quỹ phép…</div> : detail.isError || !balance ? <Alert type="error" showIcon message="Không tải được quỹ phép" description={detail.isError ? errorMessage(detail.error) : undefined} /> : <Tabs items={[
      { key: "summary", label: "Tổng quan", children: <section className="leave-balance-summary"><div className="leave-identity"><span className="person-mark" aria-hidden="true">{balance.employee.fullName.slice(0, 1)}</span><div><Text strong>{balance.employee.fullName}</Text><small className="table-subtext">{balance.employee.code} · Vào làm {balance.employee.hireDate}</small></div><Tag>Phiên bản {balance.revision}</Tag></div><Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="Được hưởng">{decimal(balance.entitledDays)}</Descriptions.Item><Descriptions.Item label="Điều chỉnh">{decimal(balance.adjustmentDays)}</Descriptions.Item><Descriptions.Item label="Chuyển vào">{decimal(balance.carriedDays)}</Descriptions.Item><Descriptions.Item label="Chuyển ra">{decimal(balance.carriedOutDays)}</Descriptions.Item><Descriptions.Item label="Ứng trong năm">{decimal(balance.advanceDays)}</Descriptions.Item><Descriptions.Item label="Đã ứng từ năm sau">{decimal(balance.advancedToPreviousDays)}</Descriptions.Item><Descriptions.Item label="Đã dùng">{decimal(balance.usedDays)}</Descriptions.Item><Descriptions.Item label="Hoàn lại">{decimal(balance.refundedDays)}</Descriptions.Item><Descriptions.Item label="Phép năm còn lại">{decimal(balance.annualDays)}</Descriptions.Item><Descriptions.Item label="Khả dụng">{decimal(balance.availableDays)}</Descriptions.Item><Descriptions.Item label="Phép chuyển hết hạn">{decimal(balance.expiredCarryDays)}</Descriptions.Item><Descriptions.Item label="Cần đối soát">{decimal(balance.reconciliationDays)}</Descriptions.Item>
      </Descriptions><CalculationView calculation={balance.calculation} /></section> },
      { key: "ledger", label: "Sổ quỹ (" + balance.entries.length + ")", children: <section className="leave-ledger"><Alert type="info" showIcon message="Sổ quỹ bất biến" description="Mỗi dòng giữ nguyên số ngày có dấu, hạn dùng, người thực hiện, tham chiếu và lý do. Quỹ hết hạn hoặc cần đối soát vẫn được giữ để truy vết." /><Table rowKey="id" size="small" scroll={{ x: 1080 }} pagination={{ pageSize: 10, showSizeChanger: false }} dataSource={balance.entries} columns={ledgerColumns} locale={{ emptyText: <Empty description="Chưa có bút toán quỹ phép" /> }} /><section className="leave-snapshot"><Title level={3}>Dữ liệu chốt nghiệp vụ</Title>{balance.entries.map((entry) => <article key={entry.id}><Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}><Descriptions.Item label="Nghiệp vụ">{ledgerLabel(entry.kind, ledgerKindLabels, "Mã nghiệp vụ gốc")}</Descriptions.Item><Descriptions.Item label="Quỹ">{ledgerLabel(entry.bucket, ledgerBucketLabels, "Mã quỹ gốc")}</Descriptions.Item><Descriptions.Item label="Ngày hiệu lực">{entry.operation.effectiveDate}</Descriptions.Item><Descriptions.Item label="Người thực hiện">{entry.operation.actor.displayName}</Descriptions.Item><Descriptions.Item label="Hồ sơ / tham chiếu">{requestReference(entry)}</Descriptions.Item><Descriptions.Item label="Lý do">{entry.operation.reason}</Descriptions.Item><Descriptions.Item label="Số ngày"><span className="numeric">{decimal(entry.days)}</span></Descriptions.Item><Descriptions.Item label="Hết hạn">{entry.expiresAt ?? "—"}</Descriptions.Item></Descriptions><TechnicalJson title="Dữ liệu gốc của giao dịch" value={entry.operation.snapshot} /></article>)}</section></section> },
    ]} />}
  </Drawer>{action && balance && <FundActionModal kind={action} balance={balance} onClose={() => setAction(null)} />}</>;
}

function FundsWorkspace({ canManage }: { canManage: boolean }) {
  const thisYear = Number(vietnamToday().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [search, setSearch] = useState("");
  const [asOf, setAsOf] = useState(vietnamToday());
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ employeeId: string; year: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const context = useQuery({ queryKey: ["leave", "context"], queryFn: leaveApi.context });
  const filters = { year, search, asOf, orgUnitId, page, pageSize: 20 };
  const balances = useQuery({ queryKey: ["leave", "balances", filters], queryFn: () => leaveApi.balances(filters), placeholderData: (previous) => previous });
  const columns: ColumnsType<LeaveBalanceView> = [
    { title: "Nhân sự", render: (_, row) => <><Text strong>{row.employee.fullName}</Text><small className="table-subtext">{row.employee.code}</small></> },
    { title: "Được hưởng", dataIndex: "entitledDays", width: 115, align: "right", render: decimal }, { title: "Điều chỉnh", dataIndex: "adjustmentDays", width: 115, align: "right", render: decimal }, { title: "Chuyển vào", dataIndex: "carriedDays", width: 115, align: "right", render: decimal }, { title: "Ứng", dataIndex: "advanceDays", width: 100, align: "right", render: decimal }, { title: "Khả dụng", dataIndex: "availableDays", width: 115, align: "right", render: (value) => <Text strong className="numeric">{decimal(value)}</Text> }, { title: "Đối soát", dataIndex: "reconciliationDays", width: 115, align: "right", render: decimal },
    { title: "Thao tác", width: 100, fixed: "right", render: (_, row) => <Button type="link" onClick={() => setSelected({ employeeId: row.employee.id, year: row.year })}>Sổ quỹ</Button> },
  ];
  const resetPage = (fn: () => void) => { setPage(1); fn(); };
  return <><div className="leave-tab-heading"><div><Title level={2}>Quỹ phép</Title><Paragraph type="secondary">Chỉ hiển thị quỹ đã có bút toán. Không tự tạo quỹ khi xem; các khoản nợ, hết hạn và đối soát được giữ lại để truy vết.</Paragraph></div>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setPicker(true)}>Lập quỹ cho nhân sự</Button>}</div>
    <section className="leave-filters leave-fund-filters" aria-label="Bộ lọc quỹ phép">
      <InputNumber aria-label="Năm quỹ phép" value={year} min={1900} max={2200} precision={0} onChange={(value) => resetPage(() => setYear(value ?? thisYear))} />
      <Input.Search placeholder="Tìm mã hoặc họ tên" allowClear value={search} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => resetPage(() => setSearch(value.trim()))} enterButton={<SearchOutlined />} />
      <Select aria-label="Lọc đơn vị quỹ phép" allowClear placeholder="Tất cả đơn vị" value={orgUnitId} loading={context.isLoading} options={context.data?.units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} onChange={(value) => resetPage(() => setOrgUnitId(value))} />
      <label>Chốt tại ngày<Input type="date" value={asOf} onChange={(event) => resetPage(() => setAsOf(event.target.value || vietnamToday()))} /></label>
    </section>
    {balances.isError ? <Alert type="error" showIcon message="Không tải được danh sách quỹ phép" description={errorMessage(balances.error)} /> : <section className="panel table-panel"><Table<LeaveBalanceView> rowKey={(row) => row.id ?? `${row.employee.id}-${row.year}`} loading={balances.isLoading} dataSource={balances.data?.items ?? []} columns={columns} pagination={false} scroll={{ x: 1050 }} locale={{ emptyText: <Empty description="Chưa có quỹ phép trong điều kiện lọc. Chọn nhân sự để lập quỹ khi cần." /> }} /><div className="table-footer"><Text type="secondary">{balances.data ? `Tổng ${balances.data.total} quỹ phép` : ""}</Text><Pagination current={balances.data?.page ?? page} pageSize={balances.data?.pageSize ?? 20} total={balances.data?.total ?? 0} showSizeChanger={false} onChange={setPage} /></div></section>}
    {picker && <EmployeePicker year={year} units={context.data?.units ?? []} onClose={() => setPicker(false)} onChoose={(employee) => { setPicker(false); setSelected({ employeeId: employee.id, year }); }} />}
     {selected && <BalanceDrawer employeeId={selected.employeeId} year={selected.year} asOf={asOf} canManage={canManage} onClose={() => setSelected(null)} />}
  </>;
}

export function LeaveWorkspace({ user }: { user: AuthUser }) {
  const canConfigure = user.permissions.includes("leave.configure");
  const canReadFunds = user.permissions.includes("leave.balance.read");
  const defaultTab = canConfigure || user.permissions.includes("leave.read") ? "catalog" : "funds";
  const [tab, setTab] = useState(defaultTab);
  const tabs = useMemo(() => [
    user.permissions.includes("leave.read") ? { key: "requests", label: "Đơn nghỉ", children: <LeaveRequestsWorkspace canPlan={user.permissions.includes("leave.request")} /> } : null,
    user.permissions.includes("leave.read") ? { key: "catalog", label: "Loại nghỉ & chính sách", children: <CatalogWorkspace canConfigure={canConfigure} /> } : null,
    canReadFunds ? { key: "funds", label: "Quỹ phép", children: <FundsWorkspace canManage={user.permissions.includes("leave.balance.manage")} /> } : null,
  ].filter(Boolean) as { key: string; label: string; children: React.ReactNode }[], [canConfigure, canReadFunds, user.permissions]);
  return <section className="workspace leave-workspace" aria-labelledby="leave-title"><div className="page-heading"><div><p className="eyebrow">NGHỈ PHÉP / QUỸ PHÉP</p><Title id="leave-title" level={1}>Nghỉ & quỹ phép</Title><Paragraph type="secondary">Quản lý danh mục, chính sách và sổ quỹ phép theo đúng phạm vi quyền được cấp.</Paragraph></div></div><Tabs activeKey={tab} onChange={setTab} items={tabs} /></section>;
}
