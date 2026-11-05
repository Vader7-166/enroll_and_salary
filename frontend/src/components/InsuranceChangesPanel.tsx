import { DownloadOutlined, LockOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { organizationApi } from "../api/hrtp";
import { insuranceChangesApi } from "../api/social-insurance";
import type { C12Difference, InsuranceChangeItem } from "../api/social-insurance";

const { Paragraph, Text } = Typography;
const vnd = (value: string | null | undefined) => value == null || value === "" ? "—" : Number(value).toLocaleString("vi-VN");
const TYPE: Record<InsuranceChangeItem["changeType"], [string, string]> = { INCREASE: ["Báo tăng", "green"], DECREASE: ["Báo giảm", "red"], ADJUST: ["Điều chỉnh", "blue"] };
const CATEGORY: Record<C12Difference["category"], [string, string]> = {
  AMOUNT_DIFF: ["Lệch số tiền", "orange"], SALARY_BASE_DIFF: ["Lệch mức lương đóng", "gold"], MISSING_IN_C12: ["Thiếu trong C12", "red"], MISSING_IN_SYSTEM: ["Thiếu trong hệ thống", "purple"],
};
const lastMonth = () => { const now = new Date(); now.setMonth(now.getMonth() - 1); return now.toISOString().slice(0, 7); };

function useSites() {
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context });
  return (context.data?.units ?? []).filter(unit => unit.type === "SITE");
}

function Filters({ site, month, onSite, onMonth }: { site?: string; month: string; onSite: (value: string) => void; onMonth: (value: string) => void }) {
  const sites = useSites();
  return <div className="workspace-filters">
    <label>Cơ sở<Select value={site} onChange={onSite} style={{ minWidth: 220 }} placeholder="Chọn cơ sở" options={sites.map(unit => ({ value: unit.id, label: unit.pathLabel }))} /></label>
    <label>Tháng<Input type="month" value={month} onChange={event => event.target.value && onMonth(event.target.value)} /></label>
  </div>;
}

export function InsuranceChangesPanel({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [site, setSite] = useState<string>();
  const [month, setMonth] = useState(lastMonth);
  const current = useQuery({ queryKey: ["insurance-changes", site, month], queryFn: () => insuranceChangesApi.find(site!, month), enabled: Boolean(site) });
  const refresh = (data: Awaited<ReturnType<typeof insuranceChangesApi.generate>>) => client.setQueryData(["insurance-changes", site, month], data);
  const generate = useMutation({ mutationFn: () => insuranceChangesApi.generate(site!, month), onSuccess: refresh });
  const finalize = useMutation({ mutationFn: () => insuranceChangesApi.finalize(current.data!.list!), onSuccess: refresh });
  const exporter = useMutation({ mutationFn: () => insuranceChangesApi.export(current.data!.list!.id), onSuccess: blob => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "bien-dong-bh-" + month + ".xlsx"; link.click(); URL.revokeObjectURL(link.href); } });
  const list = current.data?.list ?? null;
  const error = current.error ?? generate.error ?? finalize.error ?? exporter.error;
  return <section aria-label="Biến động bảo hiểm" className="tab-stack">
    <Paragraph type="secondary">Danh sách sinh tự động bằng cách so diện tham gia và lương đóng BH của tháng với tháng trước. Biến động phát hiện sau khi tháng đã chốt được đưa vào tháng đang lập, gắn cờ báo muộn và tính truy thu/thoái thu theo mức đóng của tháng gốc.</Paragraph>
    <Filters site={site} month={month} onSite={setSite} onMonth={setMonth} />
    {site && <Space wrap>
      {canManage && list?.status !== "FINALIZED" && <Button icon={<ReloadOutlined />} loading={generate.isPending} onClick={() => generate.mutate()}>{list ? "Lập lại danh sách" : "Lập danh sách"}</Button>}
      {canManage && list?.status === "DRAFT" && <Popconfirm title="Chốt danh sách?" description="Danh sách đã chốt không thay đổi; biến động sau đó sẽ vào tháng kế tiếp." onConfirm={() => finalize.mutate()}><Button type="primary" icon={<LockOutlined />} loading={finalize.isPending}>Chốt để kê khai</Button></Popconfirm>}
      {list && <Button icon={<DownloadOutlined />} loading={exporter.isPending} onClick={() => exporter.mutate()}>Xuất Excel</Button>}
      {list && <Tag color={list.status === "FINALIZED" ? "success" : "gold"}>{list.status === "FINALIZED" ? "Đã chốt " + (list.finalizedBy ?? "") : "Nháp"}</Tag>}
      {list?.generatedAt && <Text type="secondary">Lập lúc {new Date(list.generatedAt).toLocaleString("vi-VN")} bởi {list.generatedBy}</Text>}
    </Space>}
    {error && <Alert type="error" showIcon message="Không thực hiện được" description={errorMessage(error)} />}
    {site && <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh sách biến động bảo hiểm; dùng phím mũi tên để cuộn"><Table<InsuranceChangeItem>     rowKey="id" size="small" loading={current.isLoading} dataSource={current.data?.items ?? []} scroll={{ x: 1100 }} pagination={false}
      locale={{ emptyText: <Empty description={list ? "Không có biến động trong tháng" : "Chưa lập danh sách tháng này"} /> }}
      expandable={{ rowExpandable: row => row.arrears.length > 0, expandedRowRender: row => <section className="workspace-table" role="region" tabIndex={0} aria-label="Chi tiết truy thu hoặc thoái thu"><Table     size="small" rowKey="originMonth" pagination={false} dataSource={row.arrears} scroll={{ x: 640 }} columns={[
        { title: "Tháng gốc", dataIndex: "originMonth" }, { title: "Loại", dataIndex: "direction", render: value => value === "ARREARS" ? "Truy thu" : "Thoái thu" },
        ...(["BHXH", "BHYT", "BHTN"] as const).map(kind => ({ title: kind + " NLĐ / DN", key: kind, render: (_: unknown, item: InsuranceChangeItem["arrears"][number]) => vnd(item.perKind[kind].employee) + " / " + vnd(item.perKind[kind].employer) })),
        { title: "Tổng", dataIndex: "total", align: "right" as const, render: vnd },
      ]} /></section> }}
      columns={[
        { title: "Nhân sự", width: 220, render: (_, row) => <>{row.employee.fullName}<small className="table-subtext">{row.employee.code}</small></> },
        { title: "Loại", width: 120, render: (_, row) => <Tag color={TYPE[row.changeType][1]}>{TYPE[row.changeType][0]}</Tag> },
        { title: "Lý do", dataIndex: "reason", width: 200 },
        { title: "Hiệu lực", dataIndex: "effectiveDate", width: 110 },
        { title: "Mức cũ", width: 120, align: "right", render: (_, row) => vnd(row.old.base?.BHXH) },
        { title: "Mức mới", width: 120, align: "right", render: (_, row) => vnd(row.new.base?.BHXH) },
        { title: "Báo muộn", width: 150, render: (_, row) => row.late ? <Tag color="volcano">Muộn — tháng {row.originMonth}</Tag> : "" },
        { title: "Truy thu / thoái thu", width: 160, align: "right", render: (_, row) => row.arrearsMonths ? vnd(row.arrearsTotal) + " (" + row.arrearsMonths + " tháng)" : "—" },
      ]} /></section>}
  </section>;
}

export function C12ReconciliationPanel({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [site, setSite] = useState<string>();
  const [month, setMonth] = useState(lastMonth);
  const [selected, setSelected] = useState<string>();
  const imports = useQuery({ queryKey: ["c12-imports", site, month], queryFn: () => insuranceChangesApi.imports(site!, month), enabled: Boolean(site) });
  const active = selected ?? imports.data?.items[0]?.id;
  const detail = useQuery({ queryKey: ["c12-import", active], queryFn: () => insuranceChangesApi.importDetail(active!), enabled: Boolean(active) });
  const upload = useMutation({ mutationFn: (file: File) => insuranceChangesApi.importC12(site!, month, file), onSuccess: data => { setSelected(data.import.id); void client.invalidateQueries({ queryKey: ["c12-imports"] }); } });
  const describe = (row: C12Difference) => {
    const value = row as Record<string, unknown>;
    if (row.category === "MISSING_IN_SYSTEM") {
      const c12 = value.c12 as { siBook: string; fullName: string; amount: string | null };
      const hints = (value.hints as Array<{ code: string; fullName: string }> | undefined) ?? [];
      return <>{c12.fullName} (sổ {c12.siBook}) — {value.reason === "SI_BOOK_NOT_FOUND" ? "không tìm thấy số sổ BHXH" : "không có số đóng trong bảng lương đã khóa"}{hints.length > 0 && <Text type="secondary"> · Gợi ý theo tên (không tự ghép): {hints.map(hint => hint.code).join(", ")}</Text>}</>;
    }
    const employee = value.employee as { code: string; fullName: string };
    if (row.category === "MISSING_IN_C12") return <>{employee.fullName} ({employee.code}) — hệ thống: {vnd(value.system as string)}</>;
    return <>{employee.fullName} ({employee.code}) — C12: {vnd(value.c12 as string)} · hệ thống: {vnd(value.system as string)} · chênh: {vnd(value.difference as string)}</>;
  };
  return <section aria-label="Đối chiếu C12" className="tab-stack">
    <Paragraph type="secondary">Nhập thông báo kết quả đóng C12 theo mẫu ánh xạ cột (mẫu mô phỏng). Hệ thống ghép theo mã số BHXH và so với số đóng trong bảng lương đã khóa; dòng không ghép được chỉ được gợi ý, không tự ghép.</Paragraph>
    <Filters site={site} month={month} onSite={value => { setSite(value); setSelected(undefined); }} onMonth={value => { setMonth(value); setSelected(undefined); }} />
    {site && canManage && <Upload accept=".xlsx,.csv" showUploadList={false} beforeUpload={file => { upload.mutate(file); return false; }}><Button icon={<UploadOutlined />} loading={upload.isPending}>Nhập tệp C12</Button></Upload>}
    {(upload.error ?? imports.error ?? detail.error) && <Alert type="error" showIcon message="Không xử lý được C12" description={errorMessage(upload.error ?? imports.error ?? detail.error)} />}
    {site && (imports.data?.items.length ?? 0) > 1 && <label>Lần nhập<Select value={active} onChange={setSelected} style={{ minWidth: 320 }} options={imports.data!.items.map(item => ({ value: item.id, label: new Date(item.importedAt).toLocaleString("vi-VN") + " — " + item.fileName }))} /></label>}
    {detail.data && <Alert type={detail.data.differences.length ? "warning" : "success"} showIcon message={`${detail.data.import.summary.rows} dòng C12, ${detail.data.import.summary.matched} ghép được, ${detail.data.differences.length} chênh lệch`} />}
    {site && <section className="workspace-table" role="region" tabIndex={0} aria-label="Bảng đối chiếu C12; dùng phím mũi tên để cuộn"><Table<C12Difference>     rowKey="id" size="small" loading={detail.isLoading} dataSource={detail.data?.differences ?? []} pagination={false} scroll={{ x: 800 }}
      locale={{ emptyText: <Empty description={active ? "Không có chênh lệch" : "Chưa nhập C12 cho tháng này"} /> }}
      columns={[
        { title: "Phân loại", width: 190, render: (_, row) => <Tag color={CATEGORY[row.category][1]}>{CATEGORY[row.category][0]}</Tag> },
        { title: "Dòng C12", dataIndex: "rowNumber", width: 90, render: value => value ?? "—" },
        { title: "Chi tiết", render: (_, row) => describe(row) },
      ]} /></section>}
  </section>;
}
