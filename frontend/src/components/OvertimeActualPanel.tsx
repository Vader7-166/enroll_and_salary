import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Divider, Drawer, Empty, Grid, Pagination, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { attendanceApi } from "../api/attendance";
import type { ActualRow, OvertimeActualDetail, RawRow } from "../api/attendance";
import { errorMessage } from "../api/client";
import { AttendanceRulesView } from "./AttendanceRulesView";
import { TechnicalDetails } from "./TechnicalDetails";

const { Text } = Typography;
const PAGE_SIZE = 20;

const FLAG_LABELS: Record<string, string> = {
  UNAPPROVED_WORK: "Làm ngoài khoảng duyệt",
  APPROVED_NOT_WORKED: "Đã duyệt nhưng thiếu giờ thực tế",
  UNMATCHED_PUNCH: "Quẹt chưa xác định",
  AWAITING_PUNCHES: "Chờ lượt quẹt",
  MISSING_IN: "Thiếu lượt vào",
  MISSING_OUT: "Thiếu lượt ra",
  ABSENT: "Vắng mặt",
  AMBIGUOUS: "Mơ hồ",
  INVALID_PAIR: "Cặp quẹt không hợp lệ",
  LATE: "Vào muộn",
  EARLY: "Ra sớm",
};
const REQUEST_STATUS: Record<string, string> = { DRAFT: "Nháp", PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Trả lại", REJECTED: "Từ chối", CANCELLED: "Đã hủy" };
const RAW_STATUS: Record<string, string> = { PROCESSED: "Đã xử lý", WAITING: "Chờ xử lý", LATE: "Đến sau chốt", UNMATCHED: "Chưa khớp", AMBIGUOUS: "Không xác định", SUPPRESSED: "Quẹt trùng liên tiếp" };
const DIRECTION_LABEL: Record<RawRow["direction"], string> = { IN: "Vào", OUT: "Ra", AUTO: "Tự xác định" };

type NavigateTarget = "daily" | "raw" | "overtime" | "corrections";

function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Dữ liệu đối soát tăng ca" />;
}

function vietnamTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short",
  }).format(date);
}

function minutes(value: number): string {
  return `${value.toLocaleString("vi-VN")} phút`;
}

function flagTags(flags: string[]) {
  return flags.length ? <Space size={[4, 4]} wrap>{flags.map(flag => <Tag className="attendance-state" key={flag} color={flag === "UNAPPROVED_WORK" || flag === "APPROVED_NOT_WORKED" ? "volcano" : "gold"}>{FLAG_LABELS[flag] ?? "Ngoại lệ cần rà soát"}</Tag>)}</Space> : <Text type="secondary">Không có</Text>;
}

function RawPunchTable({ punches }: { punches: RawRow[] }) {
  const columns: ColumnsType<RawRow> = [
    { title: "Thời điểm", dataIndex: "punchedAt", render: vietnamTime, width: 160 },
    { title: "Chiều quẹt", dataIndex: "direction", width: 105, render: value => DIRECTION_LABEL[value as RawRow["direction"]] ?? value },
    { title: "Thiết bị", dataIndex: "deviceCode", width: 160 },
    { title: "Dòng tệp", dataIndex: "rowNumber", width: 95, render: value => `Dòng ${value}` },
    { title: "Trạng thái nguồn", dataIndex: "state", width: 130, render: value => RAW_STATUS[value] ?? value },
  ];
  const technical = punches.map(punch => ({ id: punch.id, batchId: punch.batchId, scheduleId: punch.scheduleId, periodId: punch.periodId, source: punch.source }));
  return <>
    <Table<RawRow> rowKey="id" components={{ body: { wrapper: TableBody } }} size="small" columns={columns} dataSource={punches} pagination={false} scroll={{ x: 750 }} locale={{ emptyText: "Không có lượt quẹt nguồn." }} />
    <TechnicalDetails title="Định danh lượt quẹt"><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify(technical, null, 2)}</pre></TechnicalDetails>
  </>;
}

function SegmentTable({ detail }: { detail: OvertimeActualDetail }) {
  const requestTitles = new Map(detail.requests.map(request => [request.id, request.title]));
  const columns: ColumnsType<OvertimeActualDetail["segments"][number]> = [
    { title: "Ngày lịch", dataIndex: "calendarDate", width: 120 },
    { title: "Bắt đầu", dataIndex: "startAt", render: vietnamTime, width: 150 },
    { title: "Kết thúc", dataIndex: "endAt", render: vietnamTime, width: 150 },
    { title: "Ngày / đêm", dataIndex: "kind", width: 100, render: value => value === "NIGHT" ? "Đêm" : "Ngày" },
    { title: "Thời lượng", dataIndex: "minutes", align: "right", width: 100, render: minutes },
    { title: "Đủ điều kiện", dataIndex: "eligible", width: 130, render: value => <Tag className="attendance-state" color={value ? "green" : "default"}>{value ? "Có" : "Không"}</Tag> },
    { title: "Đăng ký liên quan", dataIndex: "requestIds", width: 250, render: (ids: string[]) => ids.length ? ids.map(id => requestTitles.get(id) ?? "Không tìm thấy tên đăng ký").join(", ") : "—" },
  ];
  return <Table<OvertimeActualDetail["segments"][number]> rowKey={segment => `${segment.startAt}-${segment.endAt}-${segment.calendarDate}`} components={{ body: { wrapper: TableBody } }} size="small" columns={columns} dataSource={detail.segments} pagination={false} scroll={{ x: 1000 }} locale={{ emptyText: "Không có phân đoạn thực tế." }} />;
}

function PairEvidence({ detail }: { detail: OvertimeActualDetail }) {
  const columns: ColumnsType<OvertimeActualDetail["pairs"][number]> = [
    { title: "Lượt vào", dataIndex: "checkInAt", width: 190, render: value => value ? vietnamTime(value) : <Text type="danger">Thiếu lượt vào</Text> },
    { title: "Lượt ra", dataIndex: "checkOutAt", width: 190, render: value => value ? vietnamTime(value) : <Text type="danger">Thiếu lượt ra</Text> },
    { title: "Cờ", dataIndex: "flags", width: 300, render: flagTags },
  ];
  return <>
    <Table<OvertimeActualDetail["pairs"][number]> rowKey="contextId" components={{ body: { wrapper: TableBody } }} size="small" columns={columns} dataSource={detail.pairs} pagination={false} scroll={{ x: 680 }} locale={{ emptyText: "Không có bằng chứng ghép lượt quẹt." }} />
    <TechnicalDetails title="Định danh ngữ cảnh và lượt quẹt"><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify(detail.pairs.map(pair => ({ contextId: pair.contextId, scheduleIds: pair.scheduleIds, checkInId: pair.checkInId, checkOutId: pair.checkOutId })), null, 2)}</pre></TechnicalDetails>
  </>;
}

export function OvertimeActualPanel({ periodId, orgUnitId, search, canImport, onNavigate }: { periodId: string; orgUnitId?: string; search?: string; canImport: boolean; onNavigate?: (target: NavigateTarget, employeeCode?: string, sourceId?: string) => void }) {
  const screens = Grid.useBreakpoint();
  const [page, setPage] = useState(1);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const actuals = useQuery({
    queryKey: ["attendance-overtime-actuals", periodId, orgUnitId, search, exceptionsOnly, page],
    queryFn: () => attendanceApi.overtimeActuals({ periodId, orgUnitId, search: search || undefined, exceptionsOnly: exceptionsOnly || undefined, page, pageSize: PAGE_SIZE }),
  });
  const detail = useQuery({
    queryKey: ["attendance-overtime-actual", selectedId],
    queryFn: () => attendanceApi.overtimeActual(selectedId!),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    setPage(1);
    setSelectedId(undefined);
  }, [periodId, orgUnitId, search, exceptionsOnly]);

  const columns = useMemo<ColumnsType<ActualRow>>(() => [
    { title: "Nhân sự", key: "employee", fixed: screens.sm ? "left" : undefined, width: 210, render: (_, row) => <span><strong>{row.employee.fullName}</strong><br /><Text type="secondary">{row.employee.code}</Text></span> },
    { title: "Đơn vị", key: "orgUnit", width: 180, render: (_, row) => row.orgUnitName },
    { title: "Ngày công", dataIndex: "workDate", width: 110 },
    { title: "Đề nghị", dataIndex: "requestedMinutes", align: "right", width: 105, render: minutes },
    { title: "Đã duyệt", dataIndex: "approvedMinutes", align: "right", width: 105, render: minutes },
    { title: "Thực tế", dataIndex: "actualMinutes", align: "right", width: 105, render: minutes },
    { title: "Đủ điều kiện", dataIndex: "eligibleMinutes", align: "right", width: 125, render: minutes },
    { title: "Ngoài duyệt", dataIndex: "unapprovedMinutes", align: "right", width: 120, render: minutes },
    { title: "Ngoại lệ", dataIndex: "flags", width: 260, render: flagTags },
    { title: "Thao tác", key: "detail", fixed: screens.sm ? "right" : undefined, width: 100, render: (_, row) => <Button type="link" onClick={() => setSelectedId(row.id)} aria-label={`Xem chi tiết đối soát ${row.employee.fullName}`}>Chi tiết</Button> },
    { title: "Giải trình", key: "correction", width: 160, render: (_, row) => row.correctionId ? <Button type="link" onClick={() => onNavigate?.("corrections", row.employee.code, row.correctionId ?? undefined)}>Mở giải trình</Button> : <Text type="secondary">Chưa có</Text> },
  ], [screens.sm, onNavigate]);

  const summary = actuals.data?.summary;
  const rows = actuals.data?.items ?? [];
  return <section aria-label="Đối soát tăng ca thực tế">
    <Alert type="info" showIcon message="Giờ đủ điều kiện là giờ đối soát theo đăng ký và lượt quẹt, không phải giờ chi trả." style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
      <Select aria-label="Bộ lọc ngoại lệ đối soát tăng ca" value={exceptionsOnly ? "exceptions" : "all"} onChange={value => setExceptionsOnly(value === "exceptions")} options={[{ value: "all", label: "Tất cả đối soát" }, { value: "exceptions", label: "Chỉ ngoại lệ" }]} style={{ minWidth: 190 }} />
      {canImport && <Text type="secondary">Sau khi nhập hoặc xử lý lượt quẹt, dữ liệu đối soát sẽ được làm mới.</Text>}
    </Space>
    {actuals.isError && <Alert type="error" showIcon message="Không tải được đối soát tăng ca thực tế" description={errorMessage(actuals.error)} />}
    {summary && <div className="attendance-summary" aria-label="Tổng hợp tăng ca thực tế">
      <span><strong>{minutes(summary.requestedMinutes)}</strong> đề nghị</span><span><strong>{minutes(summary.approvedMinutes)}</strong> đã duyệt</span><span><strong>{minutes(summary.actualMinutes)}</strong> thực tế</span><span><strong>{minutes(summary.eligibleMinutes)}</strong> đủ điều kiện</span><span><strong>{minutes(summary.dayMinutes)}</strong> ngày</span><span><strong>{minutes(summary.nightMinutes)}</strong> đêm</span><span><strong>{minutes(summary.unapprovedMinutes)}</strong> ngoài duyệt</span><span><strong>{summary.exceptionDays.toLocaleString("vi-VN")}</strong> ngày ngoại lệ</span>
    </div>}
    {actuals.isLoading ? <div className="attendance-workspace"><Spin /></div> : !actuals.isError && rows.length === 0 ? <Empty description="Không có dữ liệu đối soát tăng ca theo bộ lọc hiện tại." /> : <>
      <div className="table-panel attendance-table"><Table<ActualRow> rowKey="id" components={{ body: { wrapper: TableBody } }} size="middle" columns={columns} dataSource={rows} loading={actuals.isFetching} pagination={false} scroll={{ x: 1600 }} locale={{ emptyText: "Không có dữ liệu đối soát tăng ca." }} /></div>
      {actuals.data && <Pagination current={actuals.data.page} pageSize={actuals.data.pageSize} total={actuals.data.total} showSizeChanger={false} onChange={setPage} style={{ marginTop: 16 }} />}
    </>}
    <Drawer title="Chi tiết đối soát tăng ca thực tế" open={Boolean(selectedId)} onClose={() => setSelectedId(undefined)} width={980} destroyOnHidden>
      {detail.isLoading && <Spin />}
      {detail.isError && <Alert type="error" showIcon message="Không tải được chi tiết đối soát" description={errorMessage(detail.error)} />}
      {detail.data && <ActualDetail detail={detail.data} canImport={canImport} onNavigate={(target, employeeCode, sourceId) => { setSelectedId(undefined); onNavigate?.(target, employeeCode, sourceId); }} />}
    </Drawer>
  </section>;
}

function ActualDetail({ detail, canImport, onNavigate }: { detail: OvertimeActualDetail; canImport: boolean; onNavigate?: (target: NavigateTarget, employeeCode?: string, sourceId?: string) => void }) {
  const actual = detail.actual;
  const screens = Grid.useBreakpoint();
  return <>
    <Descriptions bordered size="small" column={screens.sm ? 2 : 1}>
      <Descriptions.Item label="Nhân sự">{actual.employee.code} · {actual.employee.fullName}</Descriptions.Item>
      <Descriptions.Item label="Ngày công">{actual.workDate}</Descriptions.Item>
      <Descriptions.Item label="Đề nghị">{minutes(actual.requestedMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Đã duyệt">{minutes(actual.approvedMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Thực tế">{minutes(actual.actualMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Đủ điều kiện">{minutes(actual.eligibleMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Ngày / đêm">{minutes(actual.dayMinutes)} / {minutes(actual.nightMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Làm ngoài duyệt">{minutes(actual.unapprovedMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Đã duyệt nhưng chưa làm">{minutes(actual.unworkedApprovedMinutes)}</Descriptions.Item>
      <Descriptions.Item label="Lần đối chiếu gần nhất">{vietnamTime(actual.processedAt)}</Descriptions.Item>
      <Descriptions.Item label="Ngoại lệ" span={screens.sm ? 2 : 1}>{flagTags(actual.flags)}</Descriptions.Item>
      <Descriptions.Item label="Tra cứu"><Space wrap><Button type="link" onClick={() => onNavigate?.("daily", actual.employee.code)}>Xem ngày công</Button>{canImport && <Button type="link" onClick={() => onNavigate?.("raw", actual.employee.code)}>Xem lượt quẹt gốc</Button>}{actual.correctionId && <Button type="link" onClick={() => onNavigate?.("corrections", actual.employee.code, actual.correctionId ?? undefined)}>Mở giải trình</Button>}</Space></Descriptions.Item>
      {detail.corrections?.map(correction => <Descriptions.Item key={correction.id} label="Yêu cầu liên quan"><Button type="link" onClick={() => onNavigate?.("corrections", actual.employee.code, correction.id)}>Mở giải trình</Button></Descriptions.Item>)}
    </Descriptions>
    <Divider orientation="left">Trạng thái phê duyệt</Divider>
    <Table rowKey="id" components={{ body: { wrapper: TableBody } }} size="small" pagination={false} dataSource={detail.requests} scroll={{ x: 860 }} columns={[
      { title: "Đăng ký", dataIndex: "title", width: 260 },
      { title: "Trạng thái", dataIndex: "status", width: 130, render: status => <Tag>{REQUEST_STATUS[status] ?? status}</Tag> },
      { title: "Khoảng đăng ký", key: "range", width: 280, render: (_, request) => `${vietnamTime(request.startAt)} – ${vietnamTime(request.endAt)}` },
      { title: "Thời lượng đề nghị", dataIndex: "requestedMinutes", width: 150, align: "right", render: minutes },
      { title: "Chứng từ đồng ý", dataIndex: "consentReference", width: 180, render: value => value || "—" },
    ]} locale={{ emptyText: "Không có đăng ký tăng ca phù hợp." }} />
    <TechnicalDetails title="Chi tiết kỹ thuật đăng ký"><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify(detail.requests.map(request => ({ id: request.id, revision: request.revision, employeeId: request.employeeId, orgUnitId: request.orgUnitId })), null, 2)}</pre></TechnicalDetails>
    <Divider orientation="left">Phân đoạn đối soát</Divider><SegmentTable detail={detail} />
    <Divider orientation="left">Bằng chứng ghép lượt quẹt</Divider><PairEvidence detail={detail} />
    <Divider orientation="left">Lượt quẹt gốc</Divider><RawPunchTable punches={detail.punches} />
    <Divider orientation="left">Quy tắc đối soát</Divider><AttendanceRulesView rules={detail.rules} />
  </>;
}
