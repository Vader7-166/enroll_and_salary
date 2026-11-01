import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Form, Input, InputNumber, Select, Space, Table, Tag, Typography } from "antd";
import { errorMessage } from "../api/client";
import { pitApi } from "../api/pit";
import type { TaxRuleset } from "../api/pit";

const { Title } = Typography;
const money = (value: string | number) => Number(value).toLocaleString("vi-VN") + " đ";
const SUBJECT: Record<TaxRuleset["subject"], string> = { RESIDENT_PROGRESSIVE: "Cư trú — lũy tiến", RESIDENT_FLAT_10: "Cư trú — 10%/lần", NON_RESIDENT: "Không cư trú — 20%" };
const MODE = { PREMIUM_ONLY: "Miễn phần chênh lệch", ELIGIBLE_PAYMENT: "Miễn khoản đủ điều kiện" };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

function Preview() {
  const preview = useMutation({ mutationFn: (values: { subject: string; paymentDate: string; salary: number; ot?: number; otEligible?: number; meal?: number; insurance: number; dependents: number }) => pitApi.preview({
    subject: values.subject, paymentDate: values.paymentDate, paymentDateStatus: "PROJECTED", dependents: values.dependents, deductions: { insurance: String(values.insurance ?? 0) },
    items: [{ sourceRef: "salary", kind: "SALARY", amountPaid: String(values.salary) },
      ...(values.ot ? [{ sourceRef: "ot", kind: "OT", amountPaid: String(values.ot), basePortion: String(Math.round(values.ot / 1.5)), eligibleAmount: String(values.otEligible ?? values.ot), evidenceRef: "Chạy thử" }] : []),
      ...(values.meal ? [{ sourceRef: "meal", kind: "MEAL", amountPaid: String(values.meal) }] : [])],
  }) });
  const gross = useMutation({ mutationFn: (values: { net: number; paymentDate: string; dependents: number }) => pitApi.grossUp({ net: String(values.net), paymentDate: values.paymentDate, dependents: values.dependents }) });
  const data = preview.data;
  return <div className="tab-stack">
    <Title level={4}>Chạy thử khấu trừ</Title>
    <Form layout="inline" initialValues={{ subject: "RESIDENT_PROGRESSIVE", paymentDate: today, salary: 30000000, insurance: 3150000, dependents: 0 }} onFinish={values => preview.mutate(values)}>
      <Form.Item name="subject" label="Đối tượng"><Select style={{ width: 210 }} options={Object.entries(SUBJECT).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item name="paymentDate" label="Ngày chi"><Input type="date" /></Form.Item>
      <Form.Item name="salary" label="Lương"><InputNumber min={0} step={100000} /></Form.Item>
      <Form.Item name="ot" label="Tiền OT"><InputNumber min={0} step={100000} /></Form.Item>
      <Form.Item name="meal" label="Ăn ca"><InputNumber min={0} step={100000} /></Form.Item>
      <Form.Item name="insurance" label="BH NLĐ"><InputNumber min={0} step={10000} /></Form.Item>
      <Form.Item name="dependents" label="NPT"><InputNumber min={0} max={20} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={preview.isPending}>Tính thử</Button>
    </Form>
    {preview.isError && <Alert type="error" showIcon message="Không tính được" description={errorMessage(preview.error)} />}
    {data && <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
      { key: "rs", label: "Bộ quy tắc", children: `${data.context.ruleset.code} — kỳ thuế ${data.context.taxPeriod}` },
      { key: "branch", label: "Nhánh", children: data.branch },
      { key: "exempt", label: "Miễn thuế / chịu thuế", children: `${money(data.exemptions.exempt)} / ${money(data.exemptions.taxable)}` },
      { key: "deduct", label: "Giảm trừ", children: money(data.deductions.total ?? "0") },
      { key: "assess", label: "Thu nhập tính thuế", children: money(data.assessableIncome) },
      { key: "tax", label: "Thuế khấu trừ", children: <strong>{money(data.tax)}</strong> },
      ...(data.exemptions.exceptions.length ? [{ key: "exc", label: "Ngoại lệ", children: data.exemptions.exceptions.map(item => <Tag key={item.sourceRef} color="error">{item.code}</Tag>) }] : []),
    ]} />}
    <Title level={4}>Gross-up NET → GROSS</Title>
    <Form layout="inline" initialValues={{ net: 20000000, paymentDate: today, dependents: 0 }} onFinish={values => gross.mutate(values)}>
      <Form.Item name="net" label="NET"><InputNumber min={1} step={100000} /></Form.Item>
      <Form.Item name="paymentDate" label="Ngày chi"><Input type="date" /></Form.Item>
      <Form.Item name="dependents" label="NPT"><InputNumber min={0} max={20} /></Form.Item>
      <Button htmlType="submit" loading={gross.isPending}>Tìm GROSS</Button>
    </Form>
    {gross.isError && <Alert type="error" showIcon message="Không gross-up được" description={errorMessage(gross.error)} />}
    {gross.data && <Alert type="success" showIcon message={`GROSS ${money(gross.data.gross)} → NET ${money(gross.data.net)} (lệch ${gross.data.difference} đ, ${gross.data.iterations} vòng, ${gross.data.ruleset})`} />}
  </div>;
}

export function PitRulesetsPanel() {
  const rulesets = useQuery({ queryKey: ["pit-rulesets"], queryFn: pitApi.rulesets });
  return <div className="tab-stack">
    <Title level={4}>Bộ quy tắc thuế TNCN theo hiệu lực (ngày chi trả)</Title>
    {rulesets.isError && <Alert type="error" showIcon message="Không tải được bộ quy tắc" description={errorMessage(rulesets.error)} />}
    <Table<TaxRuleset> size="small" rowKey="id" loading={rulesets.isLoading} dataSource={rulesets.data?.items ?? []} pagination={false} scroll={{ x: 820 }}
      expandable={{ rowExpandable: row => row.brackets.length > 0, expandedRowRender: row => <Table size="small" rowKey={b => b.basis + b.bracketNo} pagination={false} dataSource={row.brackets.filter(b => b.basis === "MONTH")} columns={[
        { title: "Bậc", dataIndex: "bracketNo" }, { title: "Từ", dataIndex: "lower", render: money }, { title: "Đến", dataIndex: "upper", render: value => value ? money(value) : "Trở lên" }, { title: "Thuế suất", dataIndex: "rate", render: value => Number(value) * 100 + "%" },
      ]} /> }}
      columns={[
        { title: "Mã", dataIndex: "code" }, { title: "Đối tượng", dataIndex: "subject", render: (value: TaxRuleset["subject"]) => SUBJECT[value] },
        { title: "Hiệu lực", render: (_, row) => `${row.effectiveFrom} → ${row.effectiveTo ?? "nay"}` }, { title: "Chế độ miễn", dataIndex: "exemptionMode", render: (value: TaxRuleset["exemptionMode"]) => MODE[value] },
        { title: "Thông số", render: (_, row) => <Space wrap>{row.settings.selfDeduction && <Tag>Bản thân {money(String(row.settings.selfDeduction))}</Tag>}{row.settings.dependentDeduction && <Tag>NPT {money(String(row.settings.dependentDeduction))}</Tag>}{row.settings.rate && <Tag>{Number(row.settings.rate) * 100}%</Tag>}{row.settings.threshold && <Tag>Ngưỡng {money(String(row.settings.threshold))}</Tag>}</Space> },
        { title: "Căn cứ", dataIndex: "legalBasis", ellipsis: true },
      ]} />
    <Preview />
  </div>;
}
