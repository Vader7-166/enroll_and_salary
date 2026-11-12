import { DownloadOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Empty, InputNumber, Popconfirm, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { finalizationApi } from "../api/pit";
import type { FinalizationRun, TaxFinalization } from "../api/pit";

const { Paragraph, Text } = Typography;
const vnd = (value: string | number | null | undefined) => value == null ? "—" : Number(value).toLocaleString("vi-VN") + " đ";

/** Annual PIT finalization drafts (FR-8.5): payment-year totals, YEAR brackets, data checks, Excel draft; no e-filing. */
export function TaxFinalizationPanel({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0));
  const [lastRun, setLastRun] = useState<FinalizationRun | null>(null);
  const list = useQuery({ queryKey: ["tax-finalizations", year], queryFn: () => finalizationApi.list(year) });
  const run = useMutation({ mutationFn: () => finalizationApi.run(year), onSuccess: data => { setLastRun(data); client.setQueryData(["tax-finalizations", year], { items: data.items }); } });
  const complete = useMutation({ mutationFn: finalizationApi.complete, onSuccess: () => void client.invalidateQueries({ queryKey: ["tax-finalizations", year] }) });
  const exporter = useMutation({ mutationFn: () => finalizationApi.export(year), onSuccess: blob => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "quyet-toan-tncn-" + year + ".xlsx"; link.click(); URL.revokeObjectURL(link.href); } });
  const error = list.error ?? run.error ?? complete.error ?? exporter.error;
  return <section aria-label="Quyết toán thuế TNCN" className="tab-stack">
    <Paragraph type="secondary">Năm quyết toán theo <b>ngày chi trả thực tế</b>. Các lần chi 01/01–30/06/2026 giữ nguyên số đã khai; chênh lệch ghi ở quyết toán. Chỉ lập cho người ủy quyền quyết toán; không kê khai điện tử.</Paragraph>
    <Space wrap>
      <label>Năm <InputNumber min={2020} max={2100} value={year} onChange={value => value && (setYear(value), setLastRun(null))} /></label>
      {canManage && <Button type="primary" icon={<PlayCircleOutlined />} loading={run.isPending} onClick={() => run.mutate()}>Lập / cập nhật dự thảo</Button>}
      <Button icon={<DownloadOutlined />} loading={exporter.isPending} onClick={() => exporter.mutate()}>Xuất dự thảo hồ sơ</Button>
    </Space>
    {error && <Alert type="error" showIcon message="Không thực hiện được" description={errorMessage(error)} />}
    {lastRun && <Alert type="info" showIcon message={`Tạo ${lastRun.created} phiên bản mới, ${lastRun.unchanged} không đổi.`}
      description={lastRun.ineligible.length ? <>Không lập cho {lastRun.ineligible.length} người: {lastRun.ineligible.map(row => row.employee.code + " (" + row.label + ")").join("; ")}</> : undefined} />}
    <section className="workspace-table" role="region" tabIndex={0} aria-label="Bảng quyết toán thuế TNCN; dùng phím mũi tên để cuộn"><Table<TaxFinalization>     rowKey="id" size="small" loading={list.isLoading} dataSource={list.data?.items ?? []} pagination={false} scroll={{ x: 1150 }}
      locale={{ emptyText: <Empty description="Chưa có dự thảo cho năm này" /> }}
      expandable={{ expandedRowRender: row => <Descriptions size="small" bordered column={{ xs: 1, sm: 3 }} items={[
        { key: "p", label: "Số lần chi", children: row.summary.payments }, { key: "i", label: "Tổng thu nhập", children: vnd(row.summary.totalIncome) }, { key: "e", label: "Thu nhập miễn", children: vnd(row.summary.exempt) },
        { key: "s", label: "Bản thân (" + row.summary.selfMonths + " tháng)", children: vnd(row.summary.deductions.self) }, { key: "d", label: "NPT (" + row.summary.dependentMonths + " tháng)", children: vnd(row.summary.deductions.dependents) },
        { key: "b", label: "BH được trừ", children: vnd(row.summary.deductions.insurance) }, { key: "a", label: "Thu nhập tính thuế", children: vnd(row.summary.assessableIncome) },
        { key: "r", label: "Bộ quy tắc", children: row.ruleset }, { key: "v", label: "Phiên bản", children: row.version },
        { key: "k", label: "Biểu năm", span: 3, children: row.summary.brackets.filter(item => Number(item.portion) > 0).map(item => "bậc " + item.bracketNo + ": " + vnd(item.portion) + " × " + Number(item.rate) * 100 + "% = " + vnd(item.tax)).join("; ") || "Không phát sinh thuế" },
      ]} /> }}
      columns={[
        { title: "Nhân sự", width: 220, render: (_, row) => <>{row.employee.fullName}<small className="table-subtext">{row.employee.code}</small></> },
        { title: "Thu nhập chịu thuế", width: 150, align: "right", render: (_, row) => vnd(row.summary.taxableIncome) },
        { title: "Thuế năm", width: 130, align: "right", render: (_, row) => vnd(row.summary.annualTax) },
        { title: "Đã khấu trừ", width: 130, align: "right", render: (_, row) => vnd(row.summary.withheld) },
        { title: "Chênh lệch", width: 160, align: "right", render: (_, row) => <Text type={row.direction === "PAYABLE" ? "danger" : row.direction === "REFUND" ? "success" : undefined}>{vnd(row.summary.difference)} {row.direction === "PAYABLE" ? "(nộp thêm)" : row.direction === "REFUND" ? "(nộp thừa)" : ""}</Text> },
        { title: "Kiểm tra dữ liệu", render: (_, row) => row.issues.length ? row.issues.map(issue => <Tag key={issue.code} color={issue.blocking ? "red" : "gold"} title={issue.message}>{issue.code}</Tag>) : <Tag color="success">Đạt</Tag> },
        { title: "Trạng thái", width: 180, render: (_, row) => row.status === "DONE" ? <Tag color="success">Hoàn tất</Tag> : canManage
          ? <Popconfirm title="Hoàn tất dự thảo?" description="Dự thảo hoàn tất không sửa được; tính lại sẽ tạo phiên bản mới." onConfirm={() => complete.mutate(row)}><Button size="small" disabled={row.issues.some(issue => issue.blocking)} loading={complete.isPending}>Hoàn tất</Button></Popconfirm>
          : <Tag color="gold">Dự thảo</Tag> },
      ]} /></section>
  </section>;
}
