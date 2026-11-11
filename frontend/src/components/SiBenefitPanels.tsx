import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { employeeApi, organizationApi } from "../api/hrtp";
import { siBenefitApi } from "../api/si-benefits";
import type { AbsenceRate, SiBenefitRecord } from "../api/si-benefits";

const { Text, Paragraph } = Typography;
const vnd = (value: string | null | undefined) => value == null ? "—" : Number(value).toLocaleString("vi-VN") + " đ";
const percent = (value: string) => (Number(value) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "%";
const TYPES = [["SICK", "Ốm đau"], ["CHILD_SICK", "Con ốm"], ["MATERNITY", "Thai sản"], ["PRENATAL", "Khám thai"], ["RECOVERY", "Dưỡng sức"]];
const STATUS: Record<SiBenefitRecord["estimateStatus"], [string, string]> = { ESTIMATED: ["Dự tính", "blue"], NOT_ELIGIBLE: ["Không đủ điều kiện", "red"], INSUFFICIENT_DATA: ["Thiếu dữ liệu đóng BHXH", "gold"] };

/** KT: social-insurance-paid leave records with a traced estimate and the actual payout (FR-6.4.1). */
export function SiBenefitsPanel({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState<SiBenefitRecord | null>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [search, setSearch] = useState("");
  const [form] = Form.useForm(), [payForm] = Form.useForm();
  const list = useQuery({ queryKey: ["si-benefits", year], queryFn: () => siBenefitApi.list(year) });
  const employees = useQuery({ queryKey: ["employees", "si", search], queryFn: () => employeeApi.list({ page: 1, pageSize: 20, search }), enabled: open });
  const refresh = () => void client.invalidateQueries({ queryKey: ["si-benefits"] });
  const create = useMutation({ mutationFn: (values: Record<string, unknown>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") data.set(name, String(value));
    if (files[0]?.originFileObj) data.set("file", files[0].originFileObj);
    return siBenefitApi.create(data);
  }, onSuccess: () => { setOpen(false); form.resetFields(); setFiles([]); refresh(); } });
  const pay = useMutation({ mutationFn: (values: { amount: string; paidDate: string; reference: string }) => siBenefitApi.pay(paying!, values), onSuccess: () => { setPaying(null); payForm.resetFields(); refresh(); } });
  return <div className="tab-stack">
    <Paragraph type="secondary">Mức hưởng là <b>dự tính</b> do quỹ BHXH chi trả; ngày nghỉ không tính lương công ty. Hệ thống không lập hồ sơ gửi cơ quan BHXH.</Paragraph>
    <div className="context-strip" aria-label="Bộ lọc hồ sơ bảo hiểm"><Space wrap><label>Năm <InputNumber min={2020} max={2100} value={year} onChange={value => value && setYear(value)} /></label>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Nhập hồ sơ</Button>}</Space></div>
    {list.isError && <Alert type="error" showIcon message="Không tải được hồ sơ" description={errorMessage(list.error)} />}
    <div className="table-panel" role="region" tabIndex={0} aria-label="Danh sách hồ sơ bảo hiểm xã hội">
      <Table<SiBenefitRecord> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data?.items ?? []} pagination={false} scroll={{ x: 1150 }} locale={{ emptyText: <Empty description="Chưa có hồ sơ" /> }} columns={[
        { title: "Nhân sự", render: (_, row) => <>{row.employee.fullName}<small className="table-subtext">{row.employee.code}</small></> },
        { title: "Chế độ", width: 120, dataIndex: "benefitLabel" },
        { title: "Chứng từ", render: (_, row) => <>{row.documentNumber}<small className="table-subtext">{row.facility} · <Button type="link" size="small" onClick={() => void siBenefitApi.evidence(row).then(blob => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = row.evidence.fileName; link.click(); URL.revokeObjectURL(link.href); })}>{row.evidence.fileName}</Button></small></> },
        { title: "Khoảng ngày", width: 200, render: (_, row) => row.dateFrom + " → " + row.dateTo },
        { title: "Ngày hưởng", width: 100, align: "right", render: (_, row) => row.estimate.days },
        { title: "Dự tính", width: 200, render: (_, row) => <><Tag color={STATUS[row.estimateStatus][1]}>{STATUS[row.estimateStatus][0]}</Tag>{row.estimate.amount ? vnd(row.estimate.amount) : <small className="table-subtext">{row.estimate.reason}</small>}</> },
        { title: "Thực chi / chênh lệch", width: 200, render: (_, row) => row.paidAmount ? <>{vnd(row.paidAmount)}<small className="table-subtext">Chênh lệch {vnd(row.difference)}</small></> : canManage ? <Button size="small" onClick={() => setPaying(row)}>Ghi thực chi</Button> : "—" },
      ]} />
    </div>
    <Modal title="Nhập hồ sơ ốm đau/thai sản" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden width={620}>
      <Form form={form} layout="vertical" requiredMark="optional" onFinish={values => create.mutate(values)}>
        <Form.Item name="employeeId" label="Nhân sự" rules={[{ required: true }]}><Select showSearch filterOption={false} onSearch={setSearch} options={employees.data?.items.map(item => ({ value: item.id, label: item.code + " — " + item.fullName }))} /></Form.Item>
        <div className="form-grid">
          <Form.Item name="benefitType" label="Chế độ" rules={[{ required: true }]}><Select options={TYPES.map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="documentNumber" label="Số chứng từ" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
          <Form.Item name="dateFrom" label="Từ ngày" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="dateTo" label="Đến ngày" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="externalContributionMonths" label="Tháng đóng BHXH ngoài hệ thống"><InputNumber min={0} max={600} className="full-width" /></Form.Item>
          <Form.Item name="externalEvidence" label="Chứng từ tháng đóng ngoài hệ thống"><Input /></Form.Item>
        </div>
        <Form.Item name="facility" label="Cơ sở y tế" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item label="Tệp chứng từ (PDF/JPEG/PNG ≤ 5 MB)" required><Upload fileList={files} maxCount={1} accept=".pdf,.jpg,.jpeg,.png" beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList)}><Button icon={<UploadOutlined />}>Chọn tệp</Button></Upload></Form.Item>
        {create.isError && <Alert type="error" showIcon message="Không lưu được hồ sơ" description={errorMessage(create.error)} />}
        <Space className="modal-actions"><Button onClick={() => setOpen(false)}>Hủy</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Lưu và tính dự tính</Button></Space>
      </Form>
    </Modal>
    <Modal title="Ghi nhận tiền BHXH đã chi" open={Boolean(paying)} onCancel={() => setPaying(null)} footer={null} destroyOnHidden>
      {paying && <Text type="secondary">Dự tính: {vnd(paying.estimate.amount)}</Text>}
      <Form form={payForm} layout="vertical" onFinish={values => pay.mutate(values)}>
        <Form.Item name="amount" label="Số tiền đã chi (đồng)" rules={[{ required: true, pattern: /^\d+$/ }]}><Input inputMode="numeric" /></Form.Item>
        <Form.Item name="paidDate" label="Ngày chi" rules={[{ required: true }]}><Input type="date" /></Form.Item>
        <Form.Item name="reference" label="Chứng từ chi" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        {pay.isError && <Alert type="error" showIcon message={errorMessage(pay.error)} />}
        <Space className="modal-actions"><Button onClick={() => setPaying(null)}>Hủy</Button><Button type="primary" htmlType="submit" loading={pay.isPending}>Lưu</Button></Space>
      </Form>
    </Modal>
  </div>;
}

/** QĐ: absence rate of a workshop by team, day and leave type, with threshold warnings (FR-6.5.1, UAT-25). */
export function AbsenceRatePanel() {
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  const month = new Date().toISOString().slice(0, 7);
  const [query, setQuery] = useState({ workshopOrgUnitId: undefined as string | undefined, dateFrom: month + "-01", dateTo: new Date().toISOString().slice(0, 10) });
  const rate = useQuery({ queryKey: ["absence-rate", query], queryFn: () => siBenefitApi.absence(query.workshopOrgUnitId!, query.dateFrom, query.dateTo), enabled: Boolean(query.workshopOrgUnitId) });
  const data: AbsenceRate | undefined = rate.data;
  const days = data?.byDay.map(row => row.workDate) ?? [];
  const cell = (orgUnitId: string, workDate: string) => data?.cells.find(row => row.orgUnitId === orgUnitId && row.workDate === workDate);
  return <div className="tab-stack">
    <Paragraph type="secondary">Tỷ lệ vắng = ngày vắng (đơn nghỉ đã duyệt, không gồm ngày lễ, cộng vắng không có đơn) ÷ ca kế hoạch theo lịch đã duyệt.</Paragraph>
    <div className="context-strip" aria-label="Bộ lọc tỷ lệ vắng"><Space wrap>
      <Select style={{ minWidth: 260 }} placeholder="Chọn phân xưởng/tổ" value={query.workshopOrgUnitId} onChange={value => setQuery({ ...query, workshopOrgUnitId: value })} showSearch optionFilterProp="label" options={(context.data?.units ?? []).filter(unit => unit.type === "DEPARTMENT" || unit.type === "TEAM").map(unit => ({ value: unit.id, label: unit.pathLabel }))} />
      <Input type="date" value={query.dateFrom} onChange={event => setQuery({ ...query, dateFrom: event.target.value })} /><Input type="date" value={query.dateTo} onChange={event => setQuery({ ...query, dateTo: event.target.value })} />
    </Space></div>
    {rate.isError && <Alert type="error" showIcon message="Không tải được tỷ lệ vắng" description={errorMessage(rate.error)} />}
    {data && <>
      <Alert type={data.total.warning ? "warning" : "info"} showIcon message={"Toàn " + data.workshop.name + ": " + percent(data.total.rate) + " (" + data.total.absent + "/" + data.total.planned + " ca) — ngưỡng cảnh báo " + percent(data.threshold)} />
      <div className="table-panel" role="region" tabIndex={0} aria-label="Tỷ lệ vắng theo tổ và ngày"><Table rowKey="orgUnitId" size="small" pagination={false} scroll={{ x: 300 + days.length * 80 }} dataSource={data.byTeam} locale={{ emptyText: <Empty description="Không có lịch đã duyệt trong khoảng ngày" /> }} columns={[
        { title: "Tổ", fixed: "left" as const, width: 180, render: (_, row) => <>{row.name}<small className="table-subtext">{percent(row.rate)} · {row.absent}/{row.planned}</small></> },
        ...days.map(workDate => ({ title: workDate.slice(5), key: workDate, width: 80, align: "center" as const, render: (_: unknown, row: AbsenceRate["byTeam"][number]) => { const value = cell(row.orgUnitId, workDate); return value ? <Tag color={value.warning ? "red" : "default"}>{percent(value.rate)}</Tag> : "—"; } })),
      ]} /></div>
      <div className="table-panel" role="region" tabIndex={0} aria-label="Tổng hợp tỷ lệ vắng theo loại"><Table rowKey="code" size="small" pagination={false} dataSource={data.byType} columns={[{ title: "Loại vắng", dataIndex: "name" }, { title: "Số ngày", dataIndex: "days", align: "right" }]} /></div>
    </>}
  </div>;
}
