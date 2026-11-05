import { DownloadOutlined, EyeOutlined, FilePdfOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { periodApi } from "../api/hr-next";
import { organizationApi } from "../api/hrtp";
import { payrollInputsApi } from "../api/payroll-inputs";
import { reportsApi } from "../api/reports";
import type { ReportCatalogItem, ReportParams, ReportRun } from "../api/reports";

const { Title, Paragraph, Text } = Typography;
const GROUPS: Record<string, string> = { "10.1": "Công & OT", "10.2": "Nhân sự", "10.3": "Lương", "10.4": "BH, thuế & lao động", LABOR: "Sổ quản lý lao động" };
const format = (value: unknown, type?: string) => value === null || value === undefined ? "" : type === "money" && typeof value === "number" ? value.toLocaleString("vi-VN") : String(value);

function Params({ report, params, onChange }: { report: ReportCatalogItem; params: ReportParams; onChange: (next: ReportParams) => void }) {
  const has = (name: string) => report.params.includes(name as never);
  const periods = useQuery({ queryKey: ["attendance-periods"], queryFn: periodApi.list, enabled: has("periodId") });
  const payroll = useQuery({ queryKey: ["payroll-input-periods"], queryFn: payrollInputsApi.periods, enabled: has("payrollPeriodId") });
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context, enabled: has("orgUnitId") });
  return <Space wrap>
    {has("periodId") && <Select style={{ minWidth: 220 }} placeholder="Kỳ công" value={params.periodId} onChange={periodId => onChange({ ...params, periodId })} options={periods.data?.items.map(item => ({ value: item.id, label: item.code + " (" + item.status + ")" }))} />}
    {has("payrollPeriodId") && <Select style={{ minWidth: 220 }} placeholder="Kỳ lương" value={params.payrollPeriodId} onChange={payrollPeriodId => onChange({ ...params, payrollPeriodId })} options={payroll.data?.items.map(item => ({ value: item.id, label: item.code + " · " + item.siteName }))} />}
    {has("month") && <Input type="month" value={params.month} onChange={event => onChange({ ...params, month: event.target.value })} />}
    {has("year") && <Input style={{ width: 110 }} placeholder="Năm" value={params.year} onChange={event => onChange({ ...params, year: event.target.value })} />}
    {has("dateRange") && <><Input type="date" value={params.dateFrom} onChange={event => onChange({ ...params, dateFrom: event.target.value })} /><Input type="date" value={params.dateTo} onChange={event => onChange({ ...params, dateTo: event.target.value })} /></>}
    {has("orgUnitId") && <Select allowClear showSearch optionFilterProp="label" style={{ minWidth: 240 }} placeholder="Đơn vị (mặc định: toàn phạm vi)" value={params.orgUnitId} onChange={orgUnitId => onChange({ ...params, orgUnitId })} options={context.data?.units.map(unit => ({ value: unit.id, label: unit.pathLabel }))} />}
  </Space>;
}

function RunsTab() {
  const runs = useQuery({ queryKey: ["report-runs"], queryFn: reportsApi.runs, refetchInterval: query => query.state.data?.items.some(item => item.status === "RUNNING") ? 1500 : false });
  return <section className="workspace-table" role="region" tabIndex={0} aria-label="Lịch sử kết xuất báo cáo; dùng phím mũi tên để cuộn"><Table<ReportRun>     rowKey="id" size="small" loading={runs.isLoading} dataSource={runs.data?.items ?? []} pagination={false} scroll={{ x: 900 }} locale={{ emptyText: <Empty description="Chưa có lần kết xuất" /> }} columns={[
    { title: "Báo cáo", dataIndex: "title" }, { title: "Định dạng", dataIndex: "format", width: 90 }, { title: "Lúc", width: 170, render: (_, row) => new Date(row.requestedAt).toLocaleString("vi-VN") },
    { title: "Trạng thái", width: 200, render: (_, row) => row.status === "COMPLETED" ? <Space wrap><Tag color="success">Xong</Tag>{row.statusLabel && <Tag>{row.statusLabel}</Tag>}{row.rowWarning && <Tag color="orange">Nhiều dòng</Tag>}</Space> : row.status === "FAILED" ? <Tag color="red" title={row.failure ?? ""}>Lỗi</Tag> : <Tag color="processing">Đang chạy</Tag> },
    { title: "Số dòng", dataIndex: "rowCount", width: 90, align: "right" },
    { title: "", width: 110, render: (_, row) => row.status === "COMPLETED" && <Button size="small" icon={<DownloadOutlined />} href={reportsApi.downloadUrl(row.id)}>Tải</Button> },
  ]} /></section>;
}

export function ReportsWorkspace() {
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: ["reports-catalog"], queryFn: reportsApi.catalog });
  const [type, setType] = useState<string>();
  const [params, setParams] = useState<ReportParams>({});
  const [submitted, setSubmitted] = useState<{ type: string; params: ReportParams } | null>(null);
  const [tab, setTab] = useState("view");
  const report = catalog.data?.items.find(item => item.type === type);
  const preview = useQuery({ queryKey: ["report-preview", submitted], queryFn: () => reportsApi.preview(submitted!.type, submitted!.params), enabled: Boolean(submitted) });
  const exporter = useMutation({ mutationFn: (formatName: "XLSX" | "PDF") => reportsApi.export(type!, params, formatName), onSuccess: () => { void client.invalidateQueries({ queryKey: ["report-runs"] }); setTab("runs"); } });
  const data = preview.data;
  return <div className="content-stack">
    <div className="page-heading"><div><p className="eyebrow">BÁO CÁO 10.x</p><Title level={1}>Báo cáo</Title>
      <Paragraph type="secondary">Chỉ hiện báo cáo theo vai trò và phạm vi của bạn. Kỳ đã khóa đọc bản lưu (Chính thức); kỳ chưa khóa là Nháp. Mỗi lần kết xuất được lưu lại.</Paragraph></div></div>
    <section className="panel settings-panel"><Tabs activeKey={tab} onChange={setTab} items={[
      { key: "view", label: "Xem & kết xuất", children: <div className="tab-stack">
        {catalog.isError && <Alert type="error" showIcon message="Không tải được danh mục báo cáo" description={errorMessage(catalog.error)} />}
        <Select style={{ minWidth: 360 }} placeholder="Chọn báo cáo" value={type} onChange={value => { setType(value); setParams({}); setSubmitted(null); }} showSearch optionFilterProp="label"
          options={Object.entries(GROUPS).map(([group, label]) => ({ label, options: (catalog.data?.items ?? []).filter(item => item.group === group).map(item => ({ value: item.type, label: item.title })) })).filter(group => group.options.length)} />
        {report && <><Params report={report} params={params} onChange={setParams} />
          <Space wrap><Button type="primary" icon={<EyeOutlined />} onClick={() => setSubmitted({ type: report.type, params })}>Xem trước</Button>
            <Button icon={<DownloadOutlined />} loading={exporter.isPending} onClick={() => exporter.mutate("XLSX")}>Xuất Excel</Button>
            <Button icon={<FilePdfOutlined />} loading={exporter.isPending} onClick={() => exporter.mutate("PDF")}>Xuất PDF</Button></Space></>}
        {(preview.error ?? exporter.error) && <Alert type="error" showIcon message="Không chạy được báo cáo" description={errorMessage(preview.error ?? exporter.error)} />}
        {data && <>
          <Space wrap><Tag color={data.status === "OFFICIAL" ? "success" : "gold"}>{data.statusLabel}</Tag><Text>{data.periodLabel}</Text><Text type="secondary">Nguồn: {data.source}</Text></Space>
          {data.notes.map(note => <Alert key={note} type="info" showIcon message={note} />)}
          {data.rowWarning && <Alert type="warning" showIcon message={"Báo cáo có " + data.total + " dòng, vượt ngưỡng cảnh báo; nên thu hẹp tham số."} />}
          {data.truncated && <Text type="secondary">Xem trước {data.rows.length}/{data.total} dòng; tệp kết xuất có đủ.</Text>}
          <section className="workspace-table" role="region" tabIndex={0} aria-label="Xem trước báo cáo; dùng phím mũi tên để cuộn"><Table     size="small" rowKey={(_, index) => String(index)} loading={preview.isFetching} dataSource={data.rows} pagination={false} scroll={{ x: Math.max(900, data.columns.length * 110) }}
            columns={data.columns.map(column => ({ title: column.title, key: column.key, align: column.type === "money" || column.type === "number" ? "right" as const : undefined, render: (_: unknown, row: Record<string, unknown>) => format(row[column.key], column.type) }))} /></section>
        </>}
      </div> },
      { key: "runs", label: "Lịch sử kết xuất", children: <RunsTab /> },
    ]} /></section>
  </div>;
}
