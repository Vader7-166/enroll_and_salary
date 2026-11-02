import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { payrollProfileApi } from "../api/payroll-profile";
import type { PayrollProfile, SpecialStatusType } from "../api/payroll-profile";

const { Title, Text } = Typography;
const STATUS_LABEL: Record<SpecialStatusType, string> = { FOREIGN_WORKER: "Người nước ngoài", PENSIONER: "Đã hưởng lương hưu", MINOR: "Lao động chưa thành niên", FEMALE: "Lao động nữ", VOCATIONAL_TRAINED: "Đã qua đào tạo nghề" };
const dataStatusTag = (value: string) => <Tag color={value === "SIMULATION" ? "gold" : "success"}>{value === "SIMULATION" ? "Mô phỏng" : "Đã xác nhận"}</Tag>;
const dataStatusField = <Form.Item name="dataStatus" label="Nguồn dữ liệu" initialValue="SIMULATION" rules={[{ required: true }]}><Select options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }]} /></Form.Item>;
const reasonField = <Form.Item name="reason" label="Lý do / căn cứ" rules={[{ required: true, whitespace: true, message: "Nhập lý do." }]}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>;
const range = (from: string, to: string | null) => `${from} → ${to ?? "nay"}`;

type Editor = { kind: "identity" | "bank" | "tax" | "special" | "dependent"; dependent?: PayrollProfile["dependents"][number] } | null;

function EditorModal({ employeeId, editor, profile, onClose }: { employeeId: string; editor: NonNullable<Editor>; profile: PayrollProfile; onClose: () => void }) {
  const [form] = Form.useForm();
  const client = useQueryClient();
  const banks = useQuery({ queryKey: ["payroll-profile", "banks"], queryFn: payrollProfileApi.banks, enabled: editor.kind === "bank" });
  const statusType = Form.useWatch("statusType", form);
  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>): Promise<unknown> => {
      const clean = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
      if (editor.kind === "identity") return payrollProfileApi.saveIdentity(employeeId, { ...clean, revision: profile.identity?.revision ?? 0 });
      if (editor.kind === "bank") return payrollProfileApi.addBankAccount(employeeId, clean);
      if (editor.kind === "tax") return payrollProfileApi.addTaxProfile(employeeId, { finalizationAuthorized: false, ...clean });
      if (editor.kind === "special") return payrollProfileApi.addSpecialStatus(employeeId, clean);
      return editor.dependent ? payrollProfileApi.addDependentVersion(employeeId, editor.dependent.dependentKey, { ...clean, expectedVersion: editor.dependent.version }) : payrollProfileApi.addDependent(employeeId, clean);
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["payroll-profile", employeeId] }); onClose(); },
  });
  const identity = profile.identity;
  const initial = editor.kind === "identity" && identity && !profile.masked ? { documentType: identity.documentType, idNumber: identity.idNumber, idIssueDate: identity.idIssueDate, idIssuePlace: identity.idIssuePlace, taxCode: identity.taxCode, siBookNumber: identity.siBookNumber, emergencyContactName: identity.emergencyContact.name, emergencyContactPhone: identity.emergencyContact.phone, emergencyContactRelation: identity.emergencyContact.relation, documentReference: identity.documentReference, dataStatus: identity.dataStatus }
    : editor.dependent ? { fullName: editor.dependent.fullName, relationship: editor.dependent.relationship, deductionFromMonth: editor.dependent.deductionFromMonth, deductionToMonth: editor.dependent.deductionToMonth, evidenceReference: editor.dependent.evidenceReference, dataStatus: editor.dependent.dataStatus } : { documentType: "CCCD" };
  const title = { identity: "Định danh và liên hệ", bank: "Thêm tài khoản nhận lương", tax: "Thêm hồ sơ thuế", special: "Thêm diện đặc thù", dependent: editor.dependent ? "Phiên bản mới của người phụ thuộc" : "Thêm người phụ thuộc" }[editor.kind];
  const text = (name: string, label: string, required = false, extra: Record<string, unknown> = {}) => <Form.Item name={name} label={label} rules={required ? [{ required: true, whitespace: true, message: "Nhập " + label.toLowerCase() + "." }] : []} {...extra}><Input /></Form.Item>;
  const day = (name: string, label: string, required = false) => <Form.Item name={name} label={label} rules={required ? [{ required: true, message: "Chọn ngày." }] : []}><Input type="date" /></Form.Item>;
  const month = (name: string, label: string, required = false) => <Form.Item name={name} label={label} rules={required ? [{ required: true, message: "Chọn tháng." }] : []}><Input type="month" /></Form.Item>;
  return <Modal title={title} open onCancel={onClose} footer={null} destroyOnHidden width={640}>
    <Form form={form} layout="vertical" initialValues={initial} onFinish={values => mutation.mutate(values)}>
      <div className="form-grid">
        {editor.kind === "identity" && <>
          <Form.Item name="documentType" label="Loại giấy tờ" rules={[{ required: true }]}><Select options={[{ value: "CCCD", label: "CCCD / số định danh" }, { value: "PASSPORT", label: "Hộ chiếu" }]} /></Form.Item>
          {text("idNumber", "Số giấy tờ", true)}{day("idIssueDate", "Ngày cấp")}{text("idIssuePlace", "Nơi cấp")}{text("taxCode", "Mã số thuế")}{text("siBookNumber", "Số sổ BHXH")}
          {text("emergencyContactName", "Người liên hệ khẩn cấp")}{text("emergencyContactPhone", "Điện thoại liên hệ")}{text("emergencyContactRelation", "Quan hệ")}{text("documentReference", "Tệp / chứng từ đính kèm")}
        </>}
        {editor.kind === "bank" && <>
          <Form.Item name="bankCode" label="Ngân hàng" rules={[{ required: true, message: "Chọn ngân hàng." }]}><Select loading={banks.isLoading} options={banks.data?.items.map(bank => ({ value: bank.code, label: `${bank.shortName} — ${bank.name}` }))} /></Form.Item>
          {text("accountNumber", "Số tài khoản", true)}{text("accountHolder", "Chủ tài khoản", true)}{text("branch", "Chi nhánh")}{day("effectiveFrom", "Hiệu lực từ", true)}
        </>}
        {editor.kind === "tax" && <>
          <Form.Item name="residency" label="Cư trú thuế" rules={[{ required: true, message: "Chọn trạng thái cư trú." }]}><Select options={[{ value: "RESIDENT", label: "Cá nhân cư trú" }, { value: "NON_RESIDENT", label: "Cá nhân không cư trú" }]} /></Form.Item>
          {day("effectiveFrom", "Hiệu lực từ", true)}{day("effectiveTo", "Hiệu lực đến")}{text("commitmentReference", "Cam kết tạm không khấu trừ (số)")}{text("commitmentTemplateVersion", "Phiên bản mẫu cam kết")}
          <Form.Item name="finalizationAuthorized" valuePropName="checked" label=" "><Checkbox>Ủy quyền quyết toán thuế</Checkbox></Form.Item>
        </>}
        {editor.kind === "special" && <>
          <Form.Item name="statusType" label="Diện" rules={[{ required: true, message: "Chọn diện." }]}><Select options={(Object.keys(STATUS_LABEL) as SpecialStatusType[]).map(value => ({ value, label: STATUS_LABEL[value] }))} /></Form.Item>
          {text("reference", "Căn cứ / chứng từ", true)}{day("effectiveFrom", "Hiệu lực từ", true)}{day("effectiveTo", "Hiệu lực đến")}
          {statusType === "FOREIGN_WORKER" && <>{text("workPermitNumber", "Số giấy phép lao động", true)}{day("permitExpiry", "Thời hạn giấy phép", true)}</>}
        </>}
        {editor.kind === "dependent" && <>
          {text("fullName", "Họ tên", true)}{text("relationship", "Quan hệ", true)}{text("taxCode", "MST người phụ thuộc")}{day("birthDate", "Ngày sinh")}
          {month("deductionFromMonth", "Giảm trừ từ tháng", true)}{month("deductionToMonth", "Giảm trừ đến tháng")}{text("evidenceReference", "Chứng từ chứng minh", true)}
        </>}
        {dataStatusField}
      </div>
      {reasonField}
      {mutation.isError && <Alert type="error" showIcon message="Không lưu được" description={errorMessage(mutation.error)} />}
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu</Button></Space>
    </Form>
  </Modal>;
}

export function PayrollProfileTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [editor, setEditor] = useState<Editor>(null);
  const profile = useQuery({ queryKey: ["payroll-profile", employeeId], queryFn: () => payrollProfileApi.get(employeeId) });
  if (profile.isLoading) return <div className="content-loading"><Spin /></div>;
  if (profile.isError) return <Alert type="error" showIcon message="Không tải được hồ sơ lương & thuế" description={errorMessage(profile.error)} />;
  const data = profile.data!;
  const identity = data.identity;
  const section = (title: string, kind: NonNullable<Editor>["kind"], label = "Thêm") => <div className="tab-actions"><Title level={4}>{title}</Title>{canManage && <Button size="small" icon={<PlusOutlined />} onClick={() => setEditor({ kind })}>{label}</Button>}</div>;
  return <div className="tab-stack">
    {data.masked && <Alert type="info" showIcon message="Số giấy tờ và tài khoản đang được che theo quyền của bạn." />}
    {section("Định danh và liên hệ", "identity", identity ? "Cập nhật" : "Nhập")}
    {identity ? <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
      { key: "doc", label: identity.documentType === "CCCD" ? "CCCD" : "Hộ chiếu", children: <Text code>{identity.idNumber}</Text> },
      { key: "issue", label: "Ngày/nơi cấp", children: [identity.idIssueDate, identity.idIssuePlace].filter(Boolean).join(" — ") || "—" },
      { key: "tax", label: "Mã số thuế", children: identity.taxCode ?? "—" },
      { key: "si", label: "Số sổ BHXH", children: identity.siBookNumber ?? "—" },
      { key: "contact", label: "Liên hệ khẩn cấp", children: [identity.emergencyContact.name, identity.emergencyContact.relation, identity.emergencyContact.phone].filter(Boolean).join(" — ") || "—" },
      { key: "status", label: "Nguồn", children: <>{dataStatusTag(identity.dataStatus)} phiên bản {identity.revision}</> },
    ]} /> : <Empty description="Chưa có định danh — engine BH/thuế/chi lương sẽ báo thiếu hồ sơ" />}
    {section("Tài khoản nhận lương", "bank")}
    <Table size="small" rowKey="id" pagination={false} dataSource={data.bankAccounts} scroll={{ x: 640 }} locale={{ emptyText: "Chưa có tài khoản" }} columns={[
      { title: "Ngân hàng", dataIndex: "bankName" }, { title: "Số tài khoản", dataIndex: "accountNumber", render: value => <Text code>{value}</Text> },
      { title: "Chủ tài khoản", dataIndex: "accountHolder" }, { title: "Hiệu lực", render: (_, row) => range(row.effectiveFrom, row.effectiveTo) }, { title: "Nguồn", dataIndex: "dataStatus", render: dataStatusTag },
    ]} />
    {section("Người phụ thuộc", "dependent")}
    <Table size="small" rowKey="dependentKey" pagination={false} dataSource={data.dependents} scroll={{ x: 720 }} locale={{ emptyText: "Chưa có người phụ thuộc" }}
      expandable={{ expandedRowRender: row => <Table size="small" rowKey="version" pagination={false} dataSource={row.history} columns={[{ title: "Phiên bản", dataIndex: "version" }, { title: "Giảm trừ", render: (_, item) => range(item.deductionFromMonth, item.deductionToMonth) }, { title: "Lý do", dataIndex: "reason" }]} /> }}
      columns={[
        { title: "Họ tên", dataIndex: "fullName" }, { title: "Quan hệ", dataIndex: "relationship" }, { title: "Giảm trừ", render: (_, row) => range(row.deductionFromMonth, row.deductionToMonth) },
        { title: "Chứng từ", dataIndex: "evidenceReference" }, { title: "Bản", dataIndex: "version", width: 60 },
        ...(canManage ? [{ title: "", width: 90, render: (_: unknown, row: PayrollProfile["dependents"][number]) => <Button size="small" onClick={() => setEditor({ kind: "dependent", dependent: row })}>Sửa</Button> }] : []),
      ]} />
    {section("Hồ sơ thuế (cư trú)", "tax")}
    <Table size="small" rowKey="id" pagination={false} dataSource={data.taxProfiles} scroll={{ x: 640 }} locale={{ emptyText: "Chưa có hồ sơ thuế" }} columns={[
      { title: "Cư trú", dataIndex: "residency", render: value => value === "RESIDENT" ? "Cư trú" : "Không cư trú" }, { title: "Hiệu lực", render: (_, row) => range(row.effectiveFrom, row.effectiveTo) },
      { title: "Cam kết 08/CK-TNCN", render: (_, row) => row.commitmentReference ? `${row.commitmentReference} (${row.commitmentTemplateVersion})` : "—" }, { title: "Ủy quyền QT", dataIndex: "finalizationAuthorized", render: value => value ? "Có" : "Không" }, { title: "Nguồn", dataIndex: "dataStatus", render: dataStatusTag },
    ]} />
    {section("Diện đặc thù", "special")}
    <Table size="small" rowKey="id" pagination={false} dataSource={data.specialStatuses} scroll={{ x: 640 }} locale={{ emptyText: "Không có diện đặc thù" }} columns={[
      { title: "Diện", dataIndex: "statusType", render: (value: SpecialStatusType) => STATUS_LABEL[value] }, { title: "Hiệu lực", render: (_, row) => range(row.effectiveFrom, row.effectiveTo) },
      { title: "Căn cứ", dataIndex: "reference" }, { title: "Giấy phép", render: (_, row) => row.workPermitNumber ? `${row.workPermitNumber} (đến ${row.permitExpiry})` : "—" },
    ]} />
    {editor && <EditorModal employeeId={employeeId} editor={editor} profile={data} onClose={() => setEditor(null)} />}
  </div>;
}
