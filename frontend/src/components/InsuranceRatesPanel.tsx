import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { employeeApi } from "../api/hrtp";
import { socialInsuranceApi } from "../api/social-insurance";
import type { InsuranceRate } from "../api/social-insurance";

const { Title, Text } = Typography;
const percent = (value: string) => `${(Number(value) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 4 })}%`;
const money = (value: string) => Number(value).toLocaleString("vi-VN") + " đ";
const CAP: Record<InsuranceRate["capReference"], string> = { BASE_SALARY: "lương cơ sở", REGIONAL_MINIMUM: "lương tối thiểu vùng", NONE: "không trần" };
const REASON: Record<string, string> = { ELIGIBLE: "Thuộc diện", NO_CONTRACT: "Chưa có hợp đồng hiệu lực", CONTRACT_UNDER_1_MONTH: "HĐ dưới 1 tháng", PROBATION_ONLY: "Chỉ có HĐ thử việc", CONTRACT_NOT_ELIGIBLE: "Loại HĐ không thuộc diện", UNPAID_LEAVE_14_DAYS: "Nghỉ không lương ≥ 14 ngày", RETIREE: "Đã hưởng lương hưu", FOREIGNER_NO_UNEMPLOYMENT: "Người nước ngoài: không BHTN" };

function AddRate({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [form] = Form.useForm();
  const capReference = Form.useWatch("capReference", form);
  const mutation = useMutation({ mutationFn: (values: Record<string, unknown>) => socialInsuranceApi.addRate(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""))), onSuccess: () => { void client.invalidateQueries({ queryKey: ["insurance-rates"] }); onClose(); } });
  return <Modal title="Thêm mức đóng BH" open onCancel={onClose} footer={null} destroyOnHidden width={620}>
    <Form form={form} layout="vertical" initialValues={{ insuranceType: "BHXH", floorRegionalMinimum: true, capReference: "BASE_SALARY", capMultiplier: "20", status: "SIMULATION" }} onFinish={values => mutation.mutate(values)}>
      <div className="form-grid">
        <Form.Item name="insuranceType" label="Loại"><Select options={["BHXH", "BHYT", "BHTN", "KPCD"].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="regionCode" label="Vùng (để trống = mọi vùng)"><Select allowClear options={["I", "II", "III", "IV"].map(value => ({ value, label: "Vùng " + value }))} /></Form.Item>
        <Form.Item name="employeeRate" label="Tỷ lệ NLĐ (0,08 = 8%)" rules={[{ required: true, pattern: /^(0(\.\d{1,6})?|1)$/, message: "Nhập tỷ lệ 0–1." }]}><Input /></Form.Item>
        <Form.Item name="employerRate" label="Tỷ lệ DN" rules={[{ required: true, pattern: /^(0(\.\d{1,6})?|1)$/, message: "Nhập tỷ lệ 0–1." }]}><Input /></Form.Item>
        <Form.Item name="capReference" label="Trần theo"><Select options={Object.entries(CAP).map(([value, label]) => ({ value, label }))} /></Form.Item>
        {capReference !== "NONE" && <Form.Item name="capMultiplier" label="Hệ số trần" rules={[{ required: true }]}><Input /></Form.Item>}
        <Form.Item name="effectiveFrom" label="Hiệu lực từ" rules={[{ required: true, message: "Chọn ngày." }]}><Input type="date" /></Form.Item>
        <Form.Item name="status" label="Nguồn"><Select options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận" }]} /></Form.Item>
      </div>
      <Form.Item name="floorRegionalMinimum" valuePropName="checked"><Checkbox>Sàn bằng lương tối thiểu vùng</Checkbox></Form.Item>
      <Form.Item name="legalBasis" label="Văn bản căn cứ" rules={[{ required: true, whitespace: true, message: "Nhập văn bản căn cứ." }]}><Input /></Form.Item>
      {mutation.isError && <Alert type="error" showIcon message="Không lưu được" description={errorMessage(mutation.error)} />}
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu</Button></Space>
    </Form>
  </Modal>;
}

function Preview() {
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState<string>();
  const [month, setMonth] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()).slice(0, 7));
  const employees = useQuery({ queryKey: ["employees", "insurance-preview", search], queryFn: () => employeeApi.list({ search, page: 1, pageSize: 20 }) });
  const preview = useMutation({ mutationFn: () => socialInsuranceApi.preview(employeeId!, month) });
  const data = preview.data;
  return <section className="tab-stack">
    <Title level={4}>Chạy thử theo nhân viên/tháng</Title>
    <Space wrap>
      <Select showSearch style={{ minWidth: 320 }} placeholder="Chọn nhân viên" filterOption={false} onSearch={setSearch} value={employeeId} onChange={setEmployeeId} options={employees.data?.items.map(item => ({ value: item.id, label: `${item.code} — ${item.fullName}` }))} />
      <Input type="month" value={month} onChange={event => setMonth(event.target.value)} />
      <Button type="primary" disabled={!employeeId} loading={preview.isPending} onClick={() => preview.mutate()}>Chạy thử</Button>
    </Space>
    {preview.isError && <Alert type="error" showIcon message="Không chạy thử được" description={errorMessage(preview.error)} />}
    {data && <>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
        { key: "elig", label: "Diện tham gia", children: <>{data.eligibility.reasons.map(reason => <Tag key={reason} color={reason === "ELIGIBLE" ? "success" : "warning"}>{REASON[reason] ?? reason}</Tag>)}</> },
        { key: "unpaid", label: "Ngày nghỉ không lương", children: data.unpaidLeaveDays },
        { key: "raw", label: "Tổng cấu phần tính BH", children: data.salary ? money(data.salary.raw) : "—" },
        { key: "floor", label: "Sàn", children: data.salary ? money(data.salary.floor) : "—" },
      ]} />
      {data.cp07 && <Alert type="error" showIcon message={`${data.cp07.code}: ${data.cp07.message}`} description={data.missing.length ? "Thiếu: " + data.missing.join(", ") : undefined} />}
      {data.contribution && <section className="workspace-table" role="region" tabIndex={0} aria-label="Kết quả chạy thử mức đóng bảo hiểm; dùng phím mũi tên để cuộn"><Table     size="small" rowKey="kind" pagination={false} dataSource={data.contribution.lines} scroll={{ x: 600 }} columns={[
        { title: "Khoản", dataIndex: "kind" }, { title: "Mức đóng", dataIndex: "base", align: "right", render: money },
        { title: "NLĐ", render: (_, row) => <>{money(row.employee)} <Text type="secondary">({percent(row.employeeRate)})</Text></> },
        { title: "DN", render: (_, row) => <>{money(row.employer)} <Text type="secondary">({percent(row.employerRate)})</Text></> },
      ]} summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={2}>Tổng</Table.Summary.Cell><Table.Summary.Cell index={2}>{money(data.contribution!.employeeTotal)}</Table.Summary.Cell><Table.Summary.Cell index={3}>{money(data.contribution!.employerTotal)}</Table.Summary.Cell></Table.Summary.Row>} /></section>}
    </>}
  </section>;
}

export function InsuranceRatesPanel({ canManage }: { canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  const rates = useQuery({ queryKey: ["insurance-rates"], queryFn: socialInsuranceApi.rates });
  return <div className="tab-stack">
    <div className="tab-actions"><Title level={4}>Mức đóng BH theo hiệu lực</Title>{canManage && <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>Thêm phiên bản</Button>}</div>
    {rates.isError && <Alert type="error" showIcon message="Không tải được mức đóng" description={errorMessage(rates.error)} />}
    <section className="workspace-table" role="region" tabIndex={0} aria-label="Mức đóng bảo hiểm theo hiệu lực; dùng phím mũi tên để cuộn"><Table<InsuranceRate>     size="small" rowKey="id" loading={rates.isLoading} dataSource={rates.data?.items ?? []} pagination={false} scroll={{ x: 820 }} columns={[
      { title: "Loại", dataIndex: "insuranceType", width: 80 }, { title: "Vùng", dataIndex: "regionCode", width: 70, render: value => value ?? "Mọi vùng" },
      { title: "NLĐ", dataIndex: "employeeRate", align: "right", render: percent }, { title: "DN", dataIndex: "employerRate", align: "right", render: percent },
      { title: "Trần", render: (_, row) => row.capReference === "NONE" ? "Không" : `${row.capMultiplier} × ${CAP[row.capReference]}` },
      { title: "Hiệu lực", render: (_, row) => `${row.effectiveFrom} → ${row.effectiveTo ?? "nay"}` },
      { title: "Căn cứ", dataIndex: "legalBasis", ellipsis: true }, { title: "Nguồn", dataIndex: "status", render: value => <Tag color={value === "SIMULATION" ? "gold" : "success"}>{value === "SIMULATION" ? "Mô phỏng" : "Đã xác nhận"}</Tag> },
    ]} /></section>
    <Preview />
    {adding && <AddRate onClose={() => setAdding(false)} />}
  </div>;
}
