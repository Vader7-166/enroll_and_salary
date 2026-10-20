import { useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Descriptions, Divider, Drawer, Empty, Form, Input, InputNumber,
  Modal, Pagination, Select, Space, Spin, Table, Tabs, Tag, Typography, Upload,
} from "antd";
import { DownloadOutlined, FileAddOutlined, PlayCircleOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import type { AuthUser } from "../api/hrtp";
import { errorMessage } from "../api/client";
import { attendanceApi } from "../api/attendance";
import { AttendanceCorrectionsPanel } from "./AttendanceCorrectionsPanel";
import { OvertimeActualPanel } from "./OvertimeActualPanel";
import { AttendanceTeamConfirmationPanel } from "./AttendanceTeamConfirmationPanel";
import type { AttendancePeriod, AttendanceProfile, Batch, DailyRow, ImportMapping, RawPunchState, RawRow } from "../api/attendance";
import { TechnicalDetails } from "./TechnicalDetails";
const { Title, Text, Paragraph } = Typography;
const PAGE_SIZE = 20;
const STANDARD_MAPPING: ImportMapping = {
  columns: { employeeCode: 0, date: 1, time: 2, deviceCode: 3, direction: 4 },
  delimiter: ",", encoding: "utf8", skipRows: 0, dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm:ss",
};
const attendanceFlagLabels: Record<string, string> = { MISSING_IN: "Thiếu vào", MISSING_OUT: "Thiếu ra", MISSING_PUNCH: "Thiếu quẹt", LATE: "Đi muộn", EARLY: "Về sớm", ABSENT: "Vắng", AMBIGUOUS: "Không xác định ca", AWAITING_SHIFT: "Chờ hết ca", LEAVE_SCHEDULE_CHANGED: "Lịch ca khác đơn nghỉ", LEAVE_WORK_OVERLAP: "Đi làm trùng giờ nghỉ" };
const rawStateLabels: Record<RawPunchState, string> = { PROCESSED: "Đã xử lý", WAITING: "Chờ xử lý", LATE: "Đến sau chốt", UNMATCHED: "Chưa khớp lịch", AMBIGUOUS: "Không xác định ca", SUPPRESSED: "Lượt trùng liên tiếp" };
const directionLabels = { IN: "Vào", OUT: "Ra", AUTO: "Tự xác định" };
function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Dữ liệu chấm công" />;
}

function vietnamTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

function minutes(value: number): string {
  const hours = Math.floor(value / 60);
  return `${hours}g ${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value % 60)}p`;
}


function rawStateTag(state: RawPunchState) {
  const color: Record<RawPunchState, string> = {
    PROCESSED: "green", WAITING: "gold", LATE: "orange", UNMATCHED: "red", AMBIGUOUS: "volcano", SUPPRESSED: "default",
  };
  return <Tag className="attendance-state" color={color[state]}>{rawStateLabels[state]}</Tag>;
}

function batchStatus(batch: Batch) {
  const color = batch.status === "REJECTED" ? "red" : batch.status === "ACCEPTED_WITH_EXCEPTIONS" ? "orange" : "green";
  const label = batch.status === "REJECTED" ? "Từ chối" : batch.status === "ACCEPTED_WITH_EXCEPTIONS" ? "Có ngoại lệ" : "Đã nhận";
  return <Tag className="attendance-state" color={color}>{label}</Tag>;
}

function DownloadTemplate() {
  const download = () => {
    const blob = new Blob(["NV001,2026-10-01,08:00:00,MAY01,IN\nNV001,2026-10-01,17:30:00,MAY01,OUT\n"], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "mau-quyet-cong.csv";
    link.click();
    URL.revokeObjectURL(href);
  };
  return <Button icon={<DownloadOutlined />} onClick={download}>Tải mẫu 5 cột</Button>;
}

function ProfileModal({ siteId, open, onClose }: { siteId: string; open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  type ProfileFormValues = { name: string; employeeCode: number; date: number; time: number; deviceCode: number; direction: number; delimiter: ImportMapping["delimiter"]; encoding: ImportMapping["encoding"]; skipRows: number; dateFormat: ImportMapping["dateFormat"]; timeFormat: ImportMapping["timeFormat"] };
  const [form] = Form.useForm<ProfileFormValues>();
  const mutation = useMutation({
    mutationFn: (value: ProfileFormValues) => {
      const mapping: ImportMapping = {
        columns: {
          employeeCode: Number(value.employeeCode) - 1, date: Number(value.date) - 1, time: Number(value.time) - 1,
          deviceCode: Number(value.deviceCode) - 1, direction: Number(value.direction) - 1,
        },
        delimiter: value.delimiter, encoding: value.encoding, skipRows: Number(value.skipRows), dateFormat: value.dateFormat, timeFormat: value.timeFormat,
      };
      return attendanceApi.createProfile({ siteId, name: value.name, mapping });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["attendance-context"] }); onClose(); },
  });
  return <Modal title="Lưu cấu hình tệp" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Lưu cấu hình mới" confirmLoading={mutation.isPending} destroyOnClose>
    <Form form={form} layout="vertical" initialValues={{ name: "", employeeCode: 1, date: 2, time: 3, deviceCode: 4, direction: 5, ...STANDARD_MAPPING }} onFinish={(values) => mutation.mutate(values)}>
      {mutation.isError && <Alert className="attendance-alert" type="error" showIcon message={errorMessage(mutation.error)} />}
      <Form.Item name="name" label="Tên cấu hình" rules={[{ required: true, message: "Nhập tên cấu hình." }]}><Input /></Form.Item>
      <div className="attendance-mapping-grid">
        <Form.Item name="employeeCode" label="Cột mã nhân viên" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="date" label="Cột ngày" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="time" label="Cột giờ" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="deviceCode" label="Cột thiết bị" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="direction" label="Cột chiều quẹt" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="skipRows" label="Bỏ qua dòng đầu" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item>
      </div>
      <div className="attendance-mapping-grid">
        <Form.Item name="delimiter" label="Dấu phân cách"><Select options={[{ value: ",", label: "Dấu phẩy (, )" }, { value: ";", label: "Chấm phẩy (;)" }, { value: "\t", label: "Tab" }, { value: "|", label: "Gạch đứng (|)" }]} /></Form.Item>
        <Form.Item name="encoding" label="Mã hóa"><Select options={[{ value: "utf8", label: "UTF-8" }, { value: "utf16le", label: "UTF-16 LE" }, { value: "windows1258", label: "Windows-1258" }]} /></Form.Item>
        <Form.Item name="dateFormat" label="Định dạng ngày"><Select options={[{ value: "YYYY-MM-DD" }, { value: "DD/MM/YYYY" }]} /></Form.Item>
        <Form.Item name="timeFormat" label="Định dạng giờ"><Select options={[{ value: "HH:mm:ss" }, { value: "HH:mm" }]} /></Form.Item>
      </div>
      <Text type="secondary">Chỉ số cột trên màn hình bắt đầu từ 1; hệ thống lưu chỉ số bắt đầu từ 0. Mỗi lần lưu tạo cấu hình mới.</Text>
    </Form>
  </Modal>;
}

function RawDetail({ row, periods, onOpenBatch }: { row: RawRow; periods: AttendancePeriod[]; onOpenBatch: (batch: Batch) => void }) {
  const batch = useQuery({ queryKey: ["attendance-batch", row.batchId], queryFn: () => attendanceApi.importDetail(row.batchId) });
  const reasons: Record<string, string> = {
    NOT_PROCESSED: "Chưa xử lý lượt chấm công.", NO_APPROVED_SHIFT: "Chưa có lịch ca đã duyệt để ghép lượt chấm công.",
    OUTSIDE_WINDOW: "Thời điểm chấm công nằm ngoài khoảng nhận lượt vào/ra của ca.", AMBIGUOUS: "Có nhiều ca phù hợp; Admin cần kiểm tra lại lịch và lượt chấm công.",
    DUPLICATE_PUNCH: "Lượt chấm công trùng liên tiếp, không dùng lại khi tính công.", EXTRA_PUNCH: "Lượt bổ sung, không được chọn làm lượt vào hoặc ra của ca.",
    MISSING_OR_OUTSIDE_REFERENCE_PERIOD: "Chưa có kỳ công phù hợp với ngày bắt đầu ca.", PERIOD_PLANNED: "Kỳ công chưa mở nên lượt chấm công đang chờ xử lý.",
    PERIOD_CLOSED: "Kỳ công đã chốt; giữ nguồn gốc, không tự sửa kết quả công.", PERIOD_LOCKED: "Kỳ công đã khóa; giữ nguồn gốc, không tự sửa kết quả công.",
    ANCESTOR_PERIOD_CLOSED_OR_LOCKED: "Kỳ công cấp trên đã chốt hoặc khóa; không tự sửa kết quả công.",
  };
  return <>
    <Descriptions size="small" column={1} bordered>
      <Descriptions.Item label="Nhân viên">{row.employee.code} · {row.employee.fullName}</Descriptions.Item>
      <Descriptions.Item label="Thời điểm chấm công">{vietnamTime(row.punchedAt)}</Descriptions.Item>
      <Descriptions.Item label="Chiều / thiết bị">{directionLabels[row.direction]} · {row.deviceCode}</Descriptions.Item>
      <Descriptions.Item label="Trạng thái">{rawStateTag(row.state)}</Descriptions.Item>
      <Descriptions.Item label="Giải thích">{row.reason ? reasons[row.reason] ?? "Cần kiểm tra nguyên nhân xử lý cùng Admin chấm công." : "Không ghi nhận nguyên nhân ngoại lệ."}</Descriptions.Item>
      <Descriptions.Item label="Nguồn tệp">{batch.data ? <Button type="link" onClick={() => onOpenBatch(batch.data.batch)}>{batch.data.batch.fileName} · dòng {row.rowNumber}</Button> : batch.isLoading ? "Đang tải tên tệp…" : "Chưa tải được tên tệp"}</Descriptions.Item>
      <Descriptions.Item label="Ngày công / lịch ca">{row.workDate ?? "Chưa xác định ngày công"} · {row.scheduleId ? "Đã ghép lịch ca" : "Chưa ghép lịch ca"}</Descriptions.Item>
      <Descriptions.Item label="Kỳ công">{periods.find(period => period.id === row.periodId)?.code ?? (row.periodId ? "Kỳ công ngoài danh sách hiện hành" : "Chưa xác định kỳ công")}</Descriptions.Item>
    </Descriptions>
    {batch.isError && <Alert type="error" showIcon message="Không tải được tệp nguồn" description={errorMessage(batch.error)} />}
    <TechnicalDetails title="Dữ liệu và định danh gốc"><pre>{JSON.stringify(row, null, 2)}</pre></TechnicalDetails>
  </>;
}

export function AttendanceWorkspace({ user }: { user: AuthUser }) {
  const client = useQueryClient();
  const [tab, setTab] = useState("board");
  const [siteId, setSiteId] = useState<string>();
  const [periodId, setPeriodId] = useState<string>();
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const [search, setSearch] = useState("");
  const [boardPage, setBoardPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [punchPage, setPunchPage] = useState(1);
  const [punchState, setPunchState] = useState<RawPunchState>();
  const [file, setFile] = useState<File>();
  const [profileId, setProfileId] = useState<string>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [lastBatch, setLastBatch] = useState<Batch>();
  const [selectedDay, setSelectedDay] = useState<DailyRow>();
  const [selectedBatch, setSelectedBatch] = useState<Batch>();
  const [selectedRaw, setSelectedRaw] = useState<RawRow>();
  const [focusCorrectionId, setFocusCorrectionId] = useState<string>();
  const canImport = user.roles.includes("AD") && user.permissions.includes("attendance.import");
  const context = useQuery({ queryKey: ["attendance-context"], queryFn: attendanceApi.context });
  const selectedSite = context.data?.sites.find((site) => site.id === siteId);
  const sitePeriods = useMemo(() => selectedSite ? context.data?.periods.filter((period) => selectedSite.periodIds.includes(period.id)) ?? [] : [], [context.data?.periods, selectedSite]);
  const profiles = useMemo(() => context.data?.profiles.filter((profile) => profile.siteId === siteId) ?? [], [context.data, siteId]);
  const exceptionTab = tab === "exceptions";
  const board = useQuery({
    queryKey: ["attendance-board", periodId, orgUnitId, search, exceptionTab, boardPage],
    queryFn: () => attendanceApi.board({ periodId: periodId!, orgUnitId, search: search || undefined, exceptionsOnly: exceptionTab || undefined, page: boardPage, pageSize: PAGE_SIZE }),
    enabled: Boolean(periodId) && (tab === "board" || tab === "exceptions"),
  });
  const history = useQuery({ queryKey: ["attendance-imports", siteId, historyPage], queryFn: () => attendanceApi.imports(siteId!, historyPage, PAGE_SIZE), enabled: Boolean(siteId) && tab === "history" && canImport });
  const punches = useQuery({ queryKey: ["attendance-punches", siteId, punchState, search, punchPage], queryFn: () => attendanceApi.punches({ siteId: siteId!, state: punchState, search: search || undefined, page: punchPage, pageSize: PAGE_SIZE }), enabled: Boolean(siteId) && tab === "punches" && canImport });
  const dayDetail = useQuery({ queryKey: ["attendance-day", selectedDay?.id], queryFn: () => attendanceApi.day(selectedDay!.id), enabled: Boolean(selectedDay) });
  const batchDetail = useQuery({ queryKey: ["attendance-batch", selectedBatch?.id], queryFn: () => attendanceApi.importDetail(selectedBatch!.id), enabled: Boolean(selectedBatch) });
  const upload = useMutation({
    mutationFn: () => attendanceApi.importFile(file!, siteId!, periodId!, profileId),
    onSuccess: ({ batch }) => {
      setLastBatch(batch);
      setFile(undefined);
      void client.invalidateQueries({ queryKey: ["attendance-imports"] });
      void client.invalidateQueries({ queryKey: ["attendance-board"] });
      void client.invalidateQueries({ queryKey: ["attendance-punches"] });
      void client.invalidateQueries({ queryKey: ["attendance-overtime-actuals"] });
      void client.invalidateQueries({ queryKey: ["attendance-overtime-actual"] });
    },
  });
  const process = useMutation({
    mutationFn: () => attendanceApi.process({ siteId: siteId!, referencePeriodId: periodId! }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["attendance-board"] });
      void client.invalidateQueries({ queryKey: ["attendance-punches"] });
      void client.invalidateQueries({ queryKey: ["attendance-overtime-actuals"] });
      void client.invalidateQueries({ queryKey: ["attendance-overtime-actual"] });
    },
  });
  const chooseSite = (value: string) => { setSiteId(value); setPeriodId(undefined); setProfileId(undefined); setOrgUnitId(undefined); setFile(undefined); setLastBatch(undefined); setBoardPage(1); setHistoryPage(1); setPunchPage(1); };
  const choosePeriod = (value: string) => { setPeriodId(value); setBoardPage(1); setFocusCorrectionId(undefined); setSelectedDay(undefined); };
  const navigateSource = (target: "daily" | "raw" | "overtime" | "corrections", employeeCode?: string, sourceId?: string) => {
    setSelectedDay(undefined); setSelectedRaw(undefined); setSelectedBatch(undefined);
    setSearch(employeeCode ?? ""); setOrgUnitId(undefined); setBoardPage(1); setPunchPage(1); setPunchState(undefined);
    setFocusCorrectionId(target === "corrections" ? sourceId : undefined);
    setTab(target === "daily" ? "board" : target === "raw" ? "punches" : target === "overtime" ? "overtime-actual" : "corrections");
  };
  const columns = [
    { title: "Ngày công", dataIndex: "workDate", width: 112 },
    { title: "Nhân viên", width: 230, render: (_: unknown, row: DailyRow) => <><strong>{row.employee.code}</strong><span className="table-subtext">{row.employee.fullName}</span></> },
    { title: "Đơn vị", width: 180, render: (_: unknown, row: DailyRow) => <>{row.orgUnitCode}<span className="table-subtext">{row.orgUnitName}</span></> },
    { title: "Ca", width: 190, render: (_: unknown, row: DailyRow) => <>{row.shift.code} · {row.shift.name}<span className="table-subtext">{vietnamTime(row.shift.startAt)} – {vietnamTime(row.shift.endAt)}</span></> },
    { title: "Vào / ra", width: 180, render: (_: unknown, row: DailyRow) => <>{vietnamTime(row.checkInAt)}<span className="table-subtext">{vietnamTime(row.checkOutAt)}</span></> },
     { title: "Công", dataIndex: "workUnits", width: 84, align: "right" as const },
     { title: "Nghỉ đã duyệt", width: 150, render: (_: unknown, row: DailyRow) => row.leave.symbols?.length ? <>{row.leave.symbols.map(s=><Tag key={s}>{s}</Tag>)}<span className="table-subtext">{minutes(row.leave.minutes??0)}</span></> : "—" },
    { title: "Làm việc", width: 102, align: "right" as const, render: (_: unknown, row: DailyRow) => minutes(row.workedMinutes) },
    { title: "Ngoại lệ", width: 210, render: (_: unknown, row: DailyRow) => row.flags.length ? <Space size={[4, 4]} wrap>{row.flags.map(flag => <Tag className="attendance-state" color="orange" key={flag}>{attendanceFlagLabels[flag] ?? "Ngoại lệ cần rà soát"}</Tag>)}</Space> : <Tag className="attendance-state" color="green">Đủ</Tag> },
    { title: "Giải trình", width: 135, render: (_: unknown, row: DailyRow) => row.correctionId ? <Button type="link" onClick={(event) => { event.stopPropagation(); setFocusCorrectionId(row.correctionId ?? undefined); setTab("corrections"); }}>Đã giải trình/điều chỉnh</Button> : <Text type="secondary">Chưa có</Text> },
  ];
  const rawColumns = [
    { title: "Thời điểm", width: 175, render: (_: unknown, row: RawRow) => vietnamTime(row.punchedAt) },
    { title: "Nhân viên", width: 220, render: (_: unknown, row: RawRow) => <><strong>{row.employee.code}</strong><span className="table-subtext">{row.employee.fullName}</span></> },
    { title: "Chiều", dataIndex: "direction", width: 100, render: (value: RawRow["direction"]) => directionLabels[value] },
    { title: "Thiết bị", dataIndex: "deviceCode", width: 110 },
    { title: "Trạng thái", width: 130, render: (_: unknown, row: RawRow) => rawStateTag(row.state) },
    { title: "Nguồn / ghép ca", width: 220, render: (_: unknown, row: RawRow) => <>Dòng {row.rowNumber}<span className="table-subtext">{row.workDate ?? "Chưa xác định ngày công"} · {row.scheduleId ? "Đã ghép lịch ca" : "Chưa ghép lịch ca"}</span></> },
  ];
  if (context.isLoading) return <div className="attendance-workspace"><Spin /></div>;
  if (context.isError) return <div className="attendance-workspace"><Alert type="error" showIcon message="Không tải được bối cảnh chấm công" description={errorMessage(context.error)} /></div>;
  if (!context.data || context.data.sites.length === 0) return <div className="attendance-workspace"><Empty description="Chưa có địa điểm chấm công trong phạm vi của bạn." /></div>;
  return <section className="attendance-workspace" aria-labelledby="attendance-title">
    <div className="page-heading"><div><p className="eyebrow">THEO DÕI THỜI GIAN</p><Title id="attendance-title" level={1}>Chấm công</Title><Text type="secondary">Đối chiếu lịch đã duyệt với lượt quẹt thực tế theo từng ngày công.</Text></div></div>
    <div className="filter-panel attendance-filters">
      <div><Text strong>Địa điểm</Text><Select aria-label="Địa điểm" value={siteId} onChange={chooseSite} placeholder="Chọn địa điểm" options={context.data.sites.map(site => ({ value: site.id, label: `${site.code} · ${site.name}` }))} /></div>
      <div><Text strong>Kỳ tham chiếu</Text><Select aria-label="Kỳ tham chiếu" value={periodId} onChange={choosePeriod} disabled={!siteId} placeholder="Chọn kỳ công" options={sitePeriods.map(period => ({ value: period.id, label: period.code }))} /></div>
      <div><Text strong>Đơn vị</Text><Select aria-label="Đơn vị" value={orgUnitId} disabled={!siteId} onChange={value => { setOrgUnitId(value); setBoardPage(1); }} allowClear placeholder="Tất cả đơn vị" options={context.data.units.filter(unit => unit.siteId === siteId).map(unit => ({ value: unit.id, label: `${unit.code} · ${unit.name}` }))} /></div>
      <div><Text strong>Tìm nhân viên</Text><Input aria-label="Tìm nhân viên" value={search} onChange={event => { setSearch(event.target.value); setBoardPage(1); }} placeholder="Mã hoặc họ tên" /></div>
    </div>
    {!siteId || !periodId ? <Alert type="info" showIcon message="Chọn địa điểm và kỳ tham chiếu để xem bảng công." /> : <>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "board", label: "Bảng công" }, { key: "exceptions", label: "Ngoại lệ" }, { key: "overtime-actual", label: "OT thực tế" }, { key: "corrections", label: "Giải trình" }, { key: "team-confirmation", label: "Xác nhận tổ" },
        ...(canImport ? [{ key: "import", label: "Nhập tệp" }, { key: "history", label: "Lịch sử nhập" }, { key: "punches", label: "Lượt quẹt gốc" }] : []),
      ]} />
      {(tab === "board" || tab === "exceptions") && <>
        {canImport && <div className="attendance-actions"><Button icon={<PlayCircleOutlined />} loading={process.isPending} onClick={() => process.mutate()}>Xử lý lượt quẹt chờ</Button></div>}
        {process.isError && <Alert className="attendance-alert" type="error" showIcon message="Không xử lý được lượt quẹt" description={errorMessage(process.error)} />}
        {board.isError && <Alert className="attendance-alert" type="error" showIcon message="Không tải được bảng công" description={errorMessage(board.error)} />}
        {board.data && <div className="attendance-summary" aria-label="Tổng hợp bảng công"><span><strong>{board.data.summary.days}</strong> ngày công</span><span><strong>{board.data.summary.exceptionDays}</strong> ngoại lệ</span><span><strong>{minutes(board.data.summary.workedMinutes)}</strong> làm việc</span><span><strong>{minutes(board.data.summary.nightMinutes)}</strong> ban đêm</span></div>}
        <div className="table-panel attendance-table"><Table<DailyRow> rowKey="id" loading={board.isLoading} columns={columns} dataSource={board.data?.items} scroll={{ x: 1400 }} pagination={false} components={{ body: { wrapper: TableBody } }} onRow={(row) => ({ className: "clickable-row", onClick: () => setSelectedDay(row) })} /></div>
        {board.data && <Pagination className="attendance-pagination" current={board.data.page} pageSize={board.data.pageSize} total={board.data.total} showSizeChanger={false} onChange={setBoardPage} />}
      </>}
      {tab === "overtime-actual" && <>
        {canImport && <div className="attendance-actions"><Button icon={<PlayCircleOutlined />} loading={process.isPending} onClick={() => process.mutate()}>Xử lý lượt quẹt chờ</Button></div>}
        {process.isError && <Alert className="attendance-alert" type="error" showIcon message="Không xử lý được lượt quẹt" description={errorMessage(process.error)} />}
        <OvertimeActualPanel periodId={periodId} orgUnitId={orgUnitId} search={search} canImport={canImport} onNavigate={navigateSource} />
      </>}
      {tab === "corrections" && <AttendanceCorrectionsPanel user={user} periodId={periodId} orgUnitId={orgUnitId} search={search} focusCorrectionId={focusCorrectionId} onFocusHandled={() => setFocusCorrectionId(undefined)} />}
      {tab === "team-confirmation" && <AttendanceTeamConfirmationPanel user={user} periodId={periodId} onNavigate={navigateSource} />}
      {tab === "import" && canImport && <div className="attendance-import">
        <Space wrap>
          <Upload beforeUpload={() => false} maxCount={1} accept=".csv,.txt,.xlsx" fileList={file ? [{ uid: file.name, name: file.name }] : []} onChange={({ file: chosen }) => setFile(chosen.originFileObj ?? (chosen instanceof File ? chosen : undefined))} onRemove={() => { setFile(undefined); return true; }}><Button icon={<UploadOutlined />}>Chọn tệp quẹt</Button></Upload>
          <Select aria-label="Cấu hình cột" value={profileId} onChange={setProfileId} allowClear placeholder="Mẫu cột chuẩn" style={{ minWidth: 220 }} options={profiles.map(profile => ({ value: profile.id, label: profile.name + " · r" + profile.revision }))} />
          <Button icon={<SettingOutlined />} onClick={() => setProfileOpen(true)}>Lưu cấu hình cột</Button><DownloadTemplate />
          <Button type="primary" icon={<FileAddOutlined />} disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>Nhập và xử lý</Button>
        </Space>
        <Alert className="attendance-alert" type="info" showIcon message="Kỳ tham chiếu không ép ngày công" description="Lượt quẹt được ghép theo lịch đã duyệt và ngày bắt đầu ca. Kỳ chưa mở sẽ chờ xử lý; kỳ đã chốt/khóa chỉ nhận dữ liệu gốc, không sửa công." />
        {upload.isError && <Alert className="attendance-alert" type="error" showIcon message="Không nhập được tệp" description={errorMessage(upload.error)} />}
        {lastBatch && <><Alert className="attendance-alert" type={lastBatch.status === "REJECTED" ? "error" : lastBatch.status === "ACCEPTED_WITH_EXCEPTIONS" ? "warning" : "success"} showIcon message={<>{lastBatch.fileName} · {batchStatus(lastBatch)}</>} description={<Space wrap><span>{lastBatch.summary.inserted} lượt mới · {lastBatch.summary.duplicates} trùng · {lastBatch.summary.processed} đã xử lý · {lastBatch.summary.waiting} chờ · {lastBatch.summary.late} đến sau chốt · {lastBatch.summary.exceptionDays} ngày ngoại lệ</span><Button onClick={() => setSelectedBatch(lastBatch)}>Xem lô nhập</Button></Space>} />
          {lastBatch.errors.length > 0 && <ul>{lastBatch.errors.map((error, index) => <li key={index}>Dòng {error.row}: {error.message}</li>)}</ul>}
        </>}
      </div>}
      {tab === "history" && canImport && <><div className="table-panel attendance-table"><Table<Batch> rowKey="id" loading={history.isLoading} pagination={false} scroll={{ x: 1050 }} components={{ body: { wrapper: TableBody } }} onRow={(row) => ({ className: "clickable-row", onClick: () => setSelectedBatch(row) })} columns={[{ title: "Tệp", dataIndex: "fileName", width: 260 }, { title: "Địa điểm", dataIndex: "siteName", width: 180 }, { title: "Trạng thái", width: 140, render: (_: unknown, row: Batch) => batchStatus(row) }, { title: "Người nhập", width: 180, render: (_: unknown, row: Batch) => row.createdBy.displayName }, { title: "Thời điểm", width: 180, render: (_: unknown, row: Batch) => vietnamTime(row.createdAt) }, { title: "Dòng / nhận", width: 120, align: "right", render: (_: unknown, row: Batch) => `${row.totalRows} / ${row.summary.inserted}` }]} dataSource={history.data?.items} /></div>{history.isError && <Alert className="attendance-alert" type="error" showIcon message="Không tải được lịch sử nhập" description={errorMessage(history.error)} />}{history.data && <Pagination className="attendance-pagination" current={history.data.page} pageSize={history.data.pageSize} total={history.data.total} showSizeChanger={false} onChange={setHistoryPage} />}</>}
      {tab === "punches" && canImport && <><div className="attendance-raw-filter"><Select value={punchState} allowClear placeholder="Tất cả trạng thái" onChange={(value) => { setPunchState(value); setPunchPage(1); }} options={["PROCESSED", "WAITING", "LATE", "UNMATCHED", "AMBIGUOUS", "SUPPRESSED"].map((value) => ({ value, label: rawStateLabels[value as RawPunchState] }))} /></div><div className="table-panel attendance-table"><Table<RawRow> rowKey="id" loading={punches.isLoading} columns={rawColumns} dataSource={punches.data?.items} scroll={{ x: 1000 }} pagination={false} components={{ body: { wrapper: TableBody } }} onRow={(row) => ({ className: "clickable-row", onClick: () => setSelectedRaw(row) })} /></div>{punches.isError && <Alert className="attendance-alert" type="error" showIcon message="Không tải được lượt quẹt gốc" description={errorMessage(punches.error)} />}{punches.data && <Pagination className="attendance-pagination" current={punches.data.page} pageSize={punches.data.pageSize} total={punches.data.total} showSizeChanger={false} onChange={setPunchPage} />}</>}
    </>}
    <ProfileModal siteId={siteId || ""} open={profileOpen} onClose={() => setProfileOpen(false)} />
    <Drawer title="Chi tiết ngày công" width={720} open={Boolean(selectedDay)} onClose={() => setSelectedDay(undefined)}>
      {dayDetail.isLoading ? <Spin /> : dayDetail.isError ? <Alert type="error" showIcon message={errorMessage(dayDetail.error)} /> : dayDetail.data && <>
        <Descriptions size="small" bordered column={1}>
          <Descriptions.Item label="Nhân viên">{dayDetail.data.day.employee.code} · {dayDetail.data.day.employee.fullName}</Descriptions.Item>
          <Descriptions.Item label="Ngày / ca">{dayDetail.data.day.workDate} · {dayDetail.data.day.shift.code} · {dayDetail.data.day.shift.name}</Descriptions.Item>
          <Descriptions.Item label="Lịch làm việc">{vietnamTime(dayDetail.data.day.shift.startAt)} – {vietnamTime(dayDetail.data.day.shift.endAt)}</Descriptions.Item>
          <Descriptions.Item label="Vào / ra thực tế">{vietnamTime(dayDetail.data.day.checkInAt)} / {vietnamTime(dayDetail.data.day.checkOutAt)}</Descriptions.Item>
          <Descriptions.Item label="Kết quả">{dayDetail.data.day.workUnits} công · {minutes(dayDetail.data.day.workedMinutes)} làm việc · {minutes(dayDetail.data.day.nightMinutes)} ban đêm</Descriptions.Item>
          <Descriptions.Item label="Đi muộn / về sớm">{minutes(dayDetail.data.day.lateMinutes)} / {minutes(dayDetail.data.day.earlyMinutes)}</Descriptions.Item>
          <Descriptions.Item label="Ngoại lệ">{dayDetail.data.day.flags.length ? dayDetail.data.day.flags.map(flag => <Tag key={flag}>{attendanceFlagLabels[flag] ?? "Ngoại lệ cần rà soát"}</Tag>) : "Không có"}</Descriptions.Item>
          <Descriptions.Item label="Nghỉ đã duyệt">{minutes(dayDetail.data.day.leave.minutes ?? 0)} · {minutes(dayDetail.data.day.leave.paidMinutes ?? 0)} hưởng lương · {dayDetail.data.day.leave.countedUnits ?? "0"} công nghỉ</Descriptions.Item>
          <Descriptions.Item label="Lần xử lý gần nhất">{vietnamTime(dayDetail.data.day.processedAt)}</Descriptions.Item>
        </Descriptions>
        <Divider orientation="left">Khoảng nghỉ đã duyệt</Divider>
        <Table rowKey={(source, index) => source.requestId + "-" + index} size="small" pagination={false} scroll={{ x: 580 }} dataSource={dayDetail.data.day.leave.sources ?? []} columns={[
          { title: "Loại nghỉ", dataIndex: "attendanceSymbol" }, { title: "Từ", dataIndex: "startAt", render: vietnamTime }, { title: "Đến", dataIndex: "endAt", render: vietnamTime },
          { title: "Phiên bản", dataIndex: "revision" }, { title: "Ngày lễ", dataIndex: "holiday", render: value => value ? "Có" : "Không" },
        ]} />
        <Divider orientation="left">Lượt chấm công liên quan</Divider>
        <Table<RawRow> rowKey="id" size="small" pagination={false} columns={rawColumns} dataSource={dayDetail.data.punches} scroll={{ x: 1000 }} />
        <Divider orientation="left">Phân bổ thời gian làm việc</Divider>
        <Table rowKey={(segment, index) => segment.startAt + "-" + index} size="small" pagination={false} scroll={{ x: 580 }} dataSource={dayDetail.data.segments} columns={[
          { title: "Ngày", dataIndex: "calendarDate" }, { title: "Từ", dataIndex: "startAt", render: vietnamTime }, { title: "Đến", dataIndex: "endAt", render: vietnamTime },
          { title: "Ngày / đêm", dataIndex: "kind", render: value => value === "NIGHT" ? "Đêm" : "Ngày" }, { title: "Thời lượng", dataIndex: "minutes", render: minutes },
        ]} />
        <Divider orientation="left">Giải trình liên quan</Divider>
        {dayDetail.data.corrections.length ? dayDetail.data.corrections.map(correction => <p key={correction.id}><Button type="link" onClick={() => navigateSource("corrections", dayDetail.data.day.employee.code, correction.id)}>{correction.evidenceReference || correction.incidentReference || correction.reason} · Phiên bản {correction.revision}</Button></p>) : <Text type="secondary">Không có giải trình.</Text>}
        <TechnicalDetails><pre>{JSON.stringify(dayDetail.data, null, 2)}</pre></TechnicalDetails>
      </>}
    </Drawer>
    <Drawer title="Chi tiết tệp chấm công" width={760} open={Boolean(selectedBatch)} onClose={() => setSelectedBatch(undefined)}>
      {batchDetail.isLoading ? <Spin /> : batchDetail.isError ? <Alert type="error" showIcon message={errorMessage(batchDetail.error)} /> : batchDetail.data && <>
        <Descriptions size="small" bordered column={1}>
          <Descriptions.Item label="Tệp">{batchDetail.data.batch.fileName}</Descriptions.Item>
          <Descriptions.Item label="Trạng thái">{batchStatus(batchDetail.data.batch)}</Descriptions.Item>
          <Descriptions.Item label="Địa điểm">{batchDetail.data.batch.siteName}</Descriptions.Item>
          <Descriptions.Item label="Người nhập / thời điểm">{batchDetail.data.batch.createdBy.displayName} · {vietnamTime(batchDetail.data.batch.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="Kết quả nhập">{batchDetail.data.batch.totalRows} dòng · {batchDetail.data.batch.summary.inserted} lượt mới · {batchDetail.data.batch.summary.duplicates} lượt trùng · {batchDetail.data.batch.summary.processed} đã xử lý · {batchDetail.data.batch.summary.waiting} chờ xử lý · {batchDetail.data.batch.summary.late} đến sau chốt</Descriptions.Item>
        </Descriptions>
        {batchDetail.data.batch.errors.length > 0 && <Alert className="attendance-alert" type="error" showIcon message="Dòng bị từ chối" description={<ul>{batchDetail.data.batch.errors.map((error, index) => <li key={index}>Dòng {error.row}: {error.message}</li>)}</ul>} />}
        <Divider orientation="left">Lượt chấm công trong tệp</Divider>
        <Table<RawRow> rowKey="id" size="small" columns={rawColumns} dataSource={batchDetail.data.punches} scroll={{ x: 1000 }} pagination={{ pageSize: 20 }} onRow={row => ({ className: "clickable-row", onClick: () => { setSelectedBatch(undefined); setSelectedRaw(row); } })} />
        <TechnicalDetails title="Định danh và dấu kiểm tra tệp"><pre>{JSON.stringify(batchDetail.data.batch, null, 2)}</pre></TechnicalDetails>
      </>}
    </Drawer>
    <Drawer title="Nguồn lượt chấm công" width={640} open={Boolean(selectedRaw)} onClose={() => setSelectedRaw(undefined)}>{selectedRaw && <RawDetail row={selectedRaw} periods={context.data.periods} onOpenBatch={batch => { setSelectedRaw(undefined); setSelectedBatch(batch); }} />}</Drawer>
  </section>;
}
