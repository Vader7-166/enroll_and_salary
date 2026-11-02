import { useQuery } from "@tanstack/react-query";
import { Alert, Descriptions, Empty, Select, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { periodApi } from "../api/hr-next";
import { overtimePayApi } from "../api/overtime-pay";
import type { OvertimeDayType, OvertimePayBucket } from "../api/overtime-pay";

const { Paragraph, Text } = Typography;
const DAY_TYPE: Record<OvertimeDayType, string> = { THUONG: "Ngày thường", NGHI_TUAN: "Nghỉ hằng tuần", LE_TET: "Lễ, Tết" };
const percent = (value: string) => `${(Number(value) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 4 })}%`;
const hours = (minutes: string) => `${(Number(minutes) / 60).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} giờ`;

function RateBreakdown({ bucket }: { bucket: OvertimePayBucket }) {
  const b = bucket.rateBreakdown;
  return <Descriptions size="small" column={1} bordered items={[
    { key: "formula", label: "Công thức", children: b.formula },
    { key: "values", label: "Thành phần", children: bucket.kind === "NIGHT_REGULAR" ? `Phụ cấp đêm ${percent(b.nightAllowance)}` : bucket.isNight
      ? `${percent(b.dayRate)} + ${percent(b.nightAllowance)} + ${percent(b.addonRate)} × ${percent(b.daytimeRate)} = ${percent(bucket.rate)}`
      : `${percent(b.dayRate)}` },
    { key: "flag", label: "Đã có OT ban ngày trong ngày công", children: b.hasDayOt ? "Có" : "Không" },
    { key: "params", label: "Tham số áp dụng", children: b.parameters.map(p => <div key={p.paramCode}><Text code>{p.paramCode}</Text> = {p.value} ({p.scopeKey}, hiệu lực {p.effectiveFrom})</div>) },
  ]} />;
}

export function OvertimePayPanel() {
  const [periodId, setPeriodId] = useState<string>();
  const periods = useQuery({ queryKey: ["periods"], queryFn: periodApi.list });
  const buckets = useQuery({ queryKey: ["overtime-pay", "buckets", periodId], queryFn: () => overtimePayApi.buckets(periodId!), enabled: Boolean(periodId) });
  const columns: ColumnsType<OvertimePayBucket> = [
    { title: "Nhân sự", render: (_, row) => <>{row.employee.code}<br /><Text type="secondary">{row.employee.fullName}</Text></>, width: 190 },
    { title: "Ngày công", dataIndex: "workDate", width: 110 },
    { title: "Loại giờ", dataIndex: "kind", width: 130, render: (kind: OvertimePayBucket["kind"]) => kind === "OT" ? "Làm thêm" : "Giờ đêm thường" },
    { title: "Loại ngày", dataIndex: "dayType", width: 130, render: (value: OvertimeDayType) => DAY_TYPE[value] },
    { title: "Ban đêm", dataIndex: "isNight", width: 90, render: (value: boolean) => value ? "Có" : "Không" },
    { title: "Số giờ", dataIndex: "minutes", width: 100, align: "right", render: hours },
    { title: "Hệ số", dataIndex: "rate", width: 100, align: "right", render: percent },
    { title: "Nguồn", dataIndex: "sourceStatus", width: 100, render: (value: OvertimePayBucket["sourceStatus"]) => <Tag color={value === "LOCKED" ? "success" : "default"}>{value === "LOCKED" ? "Đã khóa" : "Nháp"}</Tag> },
  ];
  return <section aria-label="Giờ OT theo hệ số">
    <Paragraph type="secondary">Giờ OT đủ điều kiện (giao giữa thực tế và khoảng đã duyệt) được nhóm theo loại ngày, ban đêm và cờ “đã có OT ban ngày”. Hệ số luôn tính từ tham số pháp lý hiệu lực tại ngày công. Kỳ chưa khóa chỉ là số liệu nháp, không dùng cho bảng lương chính thức.</Paragraph>
    <div className="workspace-filters"><label>Kỳ công<Select style={{ minWidth: 280 }} value={periodId} placeholder="Chọn kỳ công" loading={periods.isLoading} onChange={setPeriodId}
      options={periods.data?.items.map(period => ({ value: period.id, label: `${period.code} — ${period.scopeOrgUnitName} (${period.dateFrom} → ${period.dateTo})` }))} /></label></div>
    {periods.isError && <Alert type="error" showIcon message="Không tải được kỳ công" description={errorMessage(periods.error)} />}
    {!periodId ? <Empty description="Chọn kỳ công để xem giờ OT theo hệ số" /> : buckets.isLoading ? <div className="workspace-loading"><Spin /> Đang tính giờ OT theo hệ số…</div>
      : buckets.isError ? <Alert type="error" showIcon message="Không tải được giờ OT theo hệ số" description={errorMessage(buckets.error)} />
      : buckets.data && <>
        <Alert className="overtime-feedback" type={buckets.data.sourceStatus === "LOCKED" ? "success" : "info"} showIcon
          message={buckets.data.sourceStatus === "LOCKED" ? "Đọc từ snapshot khóa kỳ công — dùng được cho tính lương chính thức." : "Kỳ công chưa khóa — số liệu nháp, bảng lương chính thức sẽ không chấp nhận."} />
        {buckets.data.errors.map(error => <Alert key={error.employeeId + error.workDate} className="overtime-feedback" type="error" showIcon message={`${error.workDate}: ${error.message}`} />)}
        <Table className="workspace-table" rowKey={row => [row.employeeId, row.orgUnitId, row.workDate, row.kind, row.dayType, row.isNight, row.hasDayOt].join(":")} dataSource={buckets.data.items} columns={columns} scroll={{ x: 950 }}
          expandable={{ expandedRowRender: row => <RateBreakdown bucket={row} /> }} pagination={{ pageSize: 20, showSizeChanger: false }} locale={{ emptyText: <Empty description="Kỳ công chưa có giờ OT hay giờ đêm đủ điều kiện" /> }} />
      </>}
  </section>;
}
