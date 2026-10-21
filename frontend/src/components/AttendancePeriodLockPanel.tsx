import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Grid, Input, Modal, Skeleton, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { AuthUser } from "../api/hrtp";
import { ApiError, errorMessage } from "../api/client";
import { periodLocksApi } from "../api/period-locks";
import type { PeriodLockHistory, PeriodLockInput, PeriodLockIssue, PeriodLockSnapshot, PeriodLockSummary, PeriodLockToken, PeriodLockWorkshop, PeriodReturnInput } from "../api/period-locks";
import type { TeamConfirmationDay, TeamConfirmationOvertime } from "../api/attendance-confirmations";
import { TechnicalDetails } from "./TechnicalDetails";

const { Title, Text } = Typography;
const statusLabels: Record<string, string> = { PLANNED: "Chưa mở", OPEN: "Đang mở", CLOSED: "Đã chốt, chưa khóa", LOCKED: "Đã khóa" };
const workshopLabels: Record<string, string> = { WAITING: "Chưa chốt", CLOSED: "Đã chốt", STALE: "Nguồn đã đổi", RETURNED: "Đã trả lại", LOCKED: "Đã khóa" };
const attendanceLabels: Record<string, string> = { OK: "Đủ căn cứ", ERR: "Ngày công lỗi", UNPROCESSED: "Chưa xử lý" };
const flagLabels: Record<string, string> = { LATE: "Đi muộn", EARLY: "Về sớm", ABSENT: "Vắng", MISSING_IN: "Thiếu vào", MISSING_OUT: "Thiếu ra", MISSING_PUNCH: "Thiếu quẹt", AMBIGUOUS: "Không xác định ca", AWAITING_PUNCHES: "Chờ lượt quẹt", LEAVE_WORK_OVERLAP: "Đi làm trùng giờ nghỉ", LEAVE_SCHEDULE_CHANGED: "Lịch khác đơn nghỉ" };
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 });
function SourceTableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Đối soát kỳ công, cuộn ngang để xem đủ cột" />;
}
interface FrozenDay extends TeamConfirmationDay { teamName: string }
interface FrozenOvertime extends TeamConfirmationOvertime { teamName: string; employeeCode: string; employeeName: string }

function LockedSourceRecords({ snapshot }: { snapshot: PeriodLockSnapshot }) {
  const days: FrozenDay[] = snapshot.teams.flatMap(team => team.days.map(day => ({ ...day, teamName: team.team.name })));
  const overtime: FrozenOvertime[] = snapshot.teams.flatMap(team => team.overtime.map(row => {
    const person = team.snapshot.roster.find(employee => employee.id === row.employeeId);
    return { ...row, teamName: team.team.name, employeeCode: person?.code ?? "", employeeName: person?.fullName ?? "Nhân sự trong nguồn công" };
  }));
  return <div className="team-confirmation-stack">
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: "period", label: "Kỳ nguồn", children: snapshot.period.code },
      { key: "scope", label: "Phạm vi nguồn", children: snapshot.period.scopeName },
      { key: "dates", label: "Ngày công", children: `${snapshot.period.dateFrom} — ${snapshot.period.dateTo}` },
      { key: "work", label: "Công / phút làm", children: `${number.format(snapshot.summary.workUnits)} công · ${number.format(snapshot.summary.workedMinutes)} phút` },
      { key: "ot", label: "OT duyệt / thực tế / đủ điều kiện", children: `${number.format(snapshot.summary.overtimeApprovedMinutes)} / ${number.format(snapshot.summary.overtimeActualMinutes)} / ${number.format(snapshot.summary.overtimeEligibleMinutes)} phút` },
      { key: "leave", label: "Nghỉ đã duyệt", children: `${snapshot.summary.approvedLeaveRequests} hồ sơ · ${number.format(snapshot.summary.leaveMinutes)} phút` },
    ]} />
    <section className="period-lock-source-table" aria-label="Công từng ngày trong nguồn đã khóa"><Title level={3}>Công từng nhân viên, ngày và tổ</Title>
      <Table<FrozenDay> size="small" rowKey={row => row.scheduleId} dataSource={days} pagination={{ pageSize: 20, showSizeChanger: false }} components={{ body: { wrapper: SourceTableBody } }} scroll={{ x: 1250 }} locale={{ emptyText: "Nguồn không có ngày công theo lịch." }} columns={[
        { title: "Ngày công", dataIndex: "workDate", width: 125 },
        { title: "Nhân viên", width: 220, render: (_, row) => <><strong>{row.employee.code}</strong><span className="table-subtext">{row.employee.fullName}</span></> },
        { title: "Tổ / ca", width: 230, render: (_, row) => <>{row.teamName}<span className="table-subtext">{row.shiftCode}</span></> },
        { title: "Công / làm việc", width: 160, align: "right", render: (_, row) => <>{number.format(Number(row.workUnits))} công<span className="table-subtext">{number.format(row.workedMinutes)} phút</span></> },
        { title: "Nghỉ / ký hiệu", width: 150, render: (_, row) => <>{number.format(row.leave.minutes)} phút<span className="table-subtext">{row.leave.symbols.join(", ") || "Không nghỉ"}</span></> },
        { title: "Đối soát tại lúc khóa", width: 260, render: (_, row) => <>{attendanceLabels[row.status] ?? "Cần đối soát"}<span className="table-subtext">{row.flags.map(flag => flagLabels[flag] ?? "Ngoại lệ cần đối soát").join("; ") || "Không có ngoại lệ"}</span>{row.correctionId && <span className="table-subtext">Có giải trình đã áp dụng</span>}</> },
      ]} />
    </section>
    <section className="period-lock-source-table" aria-label="OT từng ngày trong nguồn đã khóa"><Title level={3}>OT thực tế và đủ điều kiện</Title>
      <Table<FrozenOvertime> size="small" rowKey={row => `${row.employeeId}:${row.teamName}:${row.workDate}`} dataSource={overtime} pagination={{ pageSize: 20, showSizeChanger: false }} components={{ body: { wrapper: SourceTableBody } }} scroll={{ x: 1200 }} locale={{ emptyText: "Nguồn không có OT thực tế." }} columns={[
        { title: "Ngày công", dataIndex: "workDate", width: 125 },
        { title: "Nhân viên / tổ", width: 270, render: (_, row) => <><strong>{row.employeeCode} · {row.employeeName}</strong><span className="table-subtext">{row.teamName}</span></> },
        { title: "Đề nghị / duyệt", width: 155, align: "right", render: (_, row) => `${number.format(row.requestedMinutes)} / ${number.format(row.approvedMinutes)} phút` },
        { title: "Thực tế / đủ điều kiện", width: 180, align: "right", render: (_, row) => `${number.format(row.actualMinutes)} / ${number.format(row.eligibleMinutes)} phút` },
        { title: "Ngày / đêm", width: 155, align: "right", render: (_, row) => `${number.format(row.dayMinutes)} / ${number.format(row.nightMinutes)} phút` },
        { title: "Ngoài duyệt / thiếu so với duyệt", width: 220, align: "right", render: (_, row) => `${number.format(row.unapprovedMinutes)} / ${number.format(row.unworkedApprovedMinutes)} phút` },
        { title: "Giải trình", width: 130, render: (_, row) => row.adjustmentId ? "Đã áp dụng" : "Không có" },
      ]} />
    </section>
    <TechnicalDetails title="Nguồn, quy tắc và phiên bản tại thời điểm khóa"><pre>{JSON.stringify(snapshot, null, 2)}</pre></TechnicalDetails>
  </div>;
}

export function AttendancePeriodLockPanel({ user, periodId, onReviewWorkshop }: {
  user: AuthUser;
  periodId: string;
  onReviewWorkshop: (workshopId: string) => void;
}) {
  const client = useQueryClient();
  const screens = Grid.useBreakpoint();
  const review = useQuery({ queryKey: ["attendance-period-lock", periodId], queryFn: () => periodLocksApi.review(periodId) });
  const current = review.data;
  const [reviewed, setReviewed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [lockDecision, setLockDecision] = useState<{ input: PeriodLockInput; summary: PeriodLockSummary; code: string; initialization: boolean }>();
  const [returnToken, setReturnToken] = useState<PeriodLockToken>();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [history, setHistory] = useState<PeriodLockHistory>();
  const [returnForm] = Form.useForm<{ reason: string }>();
  const canWrite = user.roles.includes("KT") && user.permissions.includes("attendance.lock");
  useEffect(() => { setReviewed(false); setAcknowledged(false); setNote(""); }, [current?.sourceHash, current?.revision]);
  useEffect(() => {
    if (review.isError) { setSourceOpen(false); setHistory(undefined); setLockDecision(undefined); setReturnToken(undefined); }
  }, [review.isError]);
  const refresh = () => {
    setReviewed(false); setAcknowledged(false);
    for (const key of ["attendance-period-lock", "attendance-workshop-closure", "attendance-team-confirmation", "attendance-context", "attendance-periods"]) void client.invalidateQueries({ queryKey: [key] });
  };
  const onFailure = (error: unknown) => {
    setReviewed(false); setAcknowledged(false);
    if (error instanceof ApiError && error.status === 409) refresh();
  };
  const lock = useMutation({ mutationFn: periodLocksApi.lock, onSuccess: () => { setLockDecision(undefined); refresh(); }, onError: onFailure });
  const sendBack = useMutation({ mutationFn: (input: PeriodReturnInput) => periodLocksApi.return(input), onSuccess: () => { setReturnToken(undefined); returnForm.resetFields(); refresh(); }, onError: onFailure });
  const busy = review.isFetching || lock.isPending || sendBack.isPending;
  const lockTokenCurrent = Boolean(lockDecision && current && lockDecision.input.sourceHash === current.sourceHash && lockDecision.input.revision === current.revision);
  const returnTokenCurrent = Boolean(returnToken && current && returnToken.sourceHash === current.sourceHash && returnToken.revision === current.revision);
  const showIssues = (issues: PeriodLockIssue[]) => <ul className="team-confirmation-issues">{issues.map((issue, index) => <li key={`${issue.code}:${issue.sourceId ?? index}:${index}`}>
    <Text strong>{issue.workshopName ?? "Điều kiện toàn kỳ"}{issue.teamName ? ` · ${issue.teamName}` : ""}</Text><div>{issue.message}</div>
    {(issue.employeeCode || issue.employeeName || issue.workDate) && <span className="table-subtext">{[issue.employeeCode, issue.employeeName, issue.workDate ? `Ngày công ${issue.workDate}` : ""].filter(Boolean).join(" · ")}</span>}
    {issue.workshopOrgUnitId && <Button type="link" size="small" onClick={() => onReviewWorkshop(issue.workshopOrgUnitId!)}>Mở đối soát xưởng</Button>}
  </li>)}</ul>;
  const workshopColumns: ColumnsType<PeriodLockWorkshop> = [
    { title: "Phân xưởng", width: 260, render: (_, row) => <><strong>{row.workshop.code}</strong><span className="table-subtext">{row.workshop.name}</span></> },
    { title: "Chốt của Quản đốc", width: 180, render: (_, row) => <><Tag color={row.state === "CLOSED" || row.state === "LOCKED" ? "success" : "warning"}>{workshopLabels[row.state] ?? "Cần rà soát"}</Tag><span className="table-subtext">Phiên bản {row.revision}</span></> },
    { title: "Công / làm việc", width: 160, align: "right", render: (_, row) => <>{number.format(row.summary.workUnits)} công<span className="table-subtext">{number.format(row.summary.workedMinutes)} phút</span></> },
    { title: "OT duyệt / thực tế / đủ điều kiện", width: 240, align: "right", render: (_, row) => `${number.format(row.summary.overtimeApprovedMinutes)} / ${number.format(row.summary.overtimeActualMinutes)} / ${number.format(row.summary.overtimeEligibleMinutes)} phút` },
    { title: "Nghỉ đã duyệt", width: 150, align: "right", render: (_, row) => `${number.format(row.summary.leaveMinutes)} phút` },
    { title: "Đối soát", width: 160, render: (_, row) => <Button size="small" onClick={() => onReviewWorkshop(row.workshop.id)}>Đối soát xưởng</Button> },
  ];
  return <section className="team-confirmation period-lock" aria-labelledby="period-lock-title">
    <div className="team-confirmation-toolbar"><div><Title level={2} id="period-lock-title">Khóa kỳ công</Title><Text type="secondary">Kế toán rà soát toàn phạm vi kỳ, lưu nguồn công bất biến trước khi tính lương. Khóa kỳ không phải duyệt hoặc khóa bảng lương.</Text></div><Button onClick={refresh} loading={review.isFetching} disabled={lock.isPending || sendBack.isPending}>Tải lại</Button></div>
    {review.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
    {review.isError && <Alert type="error" showIcon message="Không tải được rà soát kỳ công" description={errorMessage(review.error)} action={<Button onClick={refresh}>Thử lại</Button>} />}
    {current && !review.isError && <div className="team-confirmation-stack">
      <div className="team-confirmation-status"><Tag color={current.period.status === "LOCKED" ? "success" : current.period.status === "CLOSED" ? "processing" : "warning"}>{statusLabels[current.period.status] ?? "Cần kiểm tra trạng thái"}</Tag><Text strong>{current.period.code} · {current.period.scopeName}</Text><Text type="secondary">{current.period.dateFrom} — {current.period.dateTo} · Phiên bản kỳ {current.revision}</Text></div>
      <Descriptions className="team-confirmation-summary" bordered size="small" column={{ xs: 1, sm: 2, xl: 3 }} items={[
        { key: "workshops", label: "Xưởng đã chốt hợp lệ", children: `${current.summary.closedWorkshops} / ${current.summary.workshops}` },
        { key: "people", label: "Nhân sự / ca đã xử lý", children: `${current.summary.employees} người · ${current.summary.processedDays}/${current.summary.scheduledDays} ca` },
        { key: "work", label: "Công / làm việc", children: `${number.format(current.summary.workUnits)} công · ${number.format(current.summary.workedMinutes)} phút` },
        { key: "ot", label: "OT duyệt / thực tế / đủ điều kiện", children: `${number.format(current.summary.overtimeApprovedMinutes)} / ${number.format(current.summary.overtimeActualMinutes)} / ${number.format(current.summary.overtimeEligibleMinutes)} phút` },
        { key: "leave", label: "Nghỉ đã duyệt", children: `${current.summary.approvedLeaveRequests} hồ sơ · ${number.format(current.summary.leaveMinutes)} phút` },
        { key: "previous", label: "Kỳ trước cùng loại/phạm vi", children: current.previousPeriod ? `${current.previousPeriod.code} · ${statusLabels[current.previousPeriod.status] ?? "Cần kiểm tra trạng thái"}` : current.initialization ? "Khởi tạo — không có kỳ trước đã tồn tại" : "Không có kỳ trước" },
      ]} />
      {current.period.status === "LOCKED" && <Alert type="success" showIcon message="Nguồn công đã khóa — chỉ đọc" description="Không mở khóa hoặc sửa kỳ này. Log đến sau không thay đổi bản lưu; phát sinh cần xử lý theo quy trình điều chỉnh ở kỳ đang mở." />}
      <section className="team-confirmation-card"><Title level={3}>Điều kiện khóa toàn kỳ</Title>{current.blockers.length ? showIssues(current.blockers) : <Text>Không còn điều kiện chặn khóa. Kiểm tra nguồn và cảnh báo trước khi quyết định.</Text>}</section>
      {current.workshops.length ? <div className="table-panel"><Table<PeriodLockWorkshop> rowKey={row => row.workshop.id} size="small" dataSource={current.workshops} columns={workshopColumns} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1150 }} components={{ body: { wrapper: SourceTableBody } }} /></div> : <Empty description="Chưa có xưởng phát sinh nguồn công trong kỳ." />}
      {Boolean(current.warnings.length) && <section className="team-confirmation-card"><Title level={3}>Cảnh báo cần Kế toán rà soát</Title>{showIssues(current.warnings)}</section>}
      {current.lockedSource && <section className="team-confirmation-card period-lock-actions"><Title level={3}>Nguồn công dùng cho bước tính lương</Title><Text>Đã khóa bởi {current.lockedSource.actor.displayName} · {dateTime.format(new Date(current.lockedSource.occurredAt))}. Các số liệu bên trên lấy từ bản lưu, không tính lại theo dữ liệu hiện hành.</Text><Button type="primary" onClick={() => setSourceOpen(true)}>Xem nguồn công đã khóa</Button></section>}
      {canWrite && current.period.status !== "LOCKED" ? <section className="team-confirmation-card period-lock-actions"><Title level={3}>Quyết định của Kế toán</Title>
        {current.initialization && <Alert type="info" showIcon message="Khóa kỳ khởi tạo" description="Không có kỳ trước đã tồn tại cùng loại/phạm vi. Quyết định khóa sẽ ghi nhận đây là kỳ khởi tạo." />}
        <Checkbox checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={!current.canLock || busy}>Tôi đã đối chiếu tất cả xưởng, nguồn công/OT/nghỉ và thứ tự khóa kỳ.</Checkbox>
        {Boolean(current.warnings.length) && <Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={!current.canLock || busy}>Tôi đã rà soát các cảnh báo và nguồn liên quan.</Checkbox>}
        <label className="period-lock-note">Ghi chú khóa kỳ<Input.TextArea aria-label="Ghi chú khóa kỳ" rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} disabled={!current.canLock || busy} /></label>
        <Button type="primary" disabled={!current.canLock || !reviewed || (current.warnings.length > 0 && !acknowledged) || busy} onClick={() => { lock.reset(); setLockDecision({ input: { periodId, revision: current.revision, sourceHash: current.sourceHash, reviewed: true, acknowledgeWarnings: acknowledged, note: note.trim() || undefined }, summary: current.summary, code: current.period.code, initialization: current.initialization }); }}>Khóa kỳ công</Button>
        {current.canReturn && <Button disabled={busy} onClick={() => { sendBack.reset(); returnForm.resetFields(); setReturnToken({ periodId, revision: current.revision, sourceHash: current.sourceHash }); }}>Trả kỳ về Mở để bổ sung</Button>}
      </section> : !canWrite && <Alert type="info" showIcon message="Chế độ chỉ đọc" description="Chỉ Kế toán có quyền khóa kỳ trong toàn phạm vi được giao mới được khóa hoặc trả kỳ trước khóa." />}
      {current.period.status === "OPEN" && current.history[0]?.action === "RETURN" && <Alert type="info" showIcon message="Đã trả kỳ về Mở" description="QĐ cần trả riêng xưởng cần sửa. Sau bổ sung, tổ xác nhận lại nguồn thay đổi và QĐ chốt lại trước khi KT khóa." />}
      <section className="team-confirmation-card"><Title level={3}>Lịch sử trả lại và khóa kỳ</Title><div className="table-panel"><Table<PeriodLockHistory> rowKey="id" size="small" dataSource={current.history} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 950 }} components={{ body: { wrapper: SourceTableBody } }} locale={{ emptyText: "Chưa có thao tác trả kỳ hoặc khóa kỳ." }} columns={[
        { title: "Phiên bản kỳ", dataIndex: "revision", width: 110, align: "right" },
        { title: "Thao tác", width: 155, render: (_, row) => <Tag color={row.action === "LOCK" ? "success" : "warning"}>{row.action === "LOCK" ? "Khóa kỳ công" : "Trả kỳ về Mở"}</Tag> },
        { title: "Người thực hiện", width: 210, render: (_, row) => row.actor.displayName },
        { title: "Thời điểm", width: 170, render: (_, row) => dateTime.format(new Date(row.occurredAt)) },
        { title: "Ghi chú / lý do", dataIndex: "note", width: 220 },
        { title: "Bản lưu", width: 110, render: (_, row) => <Button size="small" onClick={() => setHistory(row)}>Xem bản lưu</Button> },
      ]} /></div></section>
      <TechnicalDetails title="Chi tiết kỹ thuật kỳ và kiểm tra nguồn"><pre>{JSON.stringify({ periodId, revision: current.revision, sourceHash: current.sourceHash, blockers: current.blockers, warnings: current.warnings }, null, 2)}</pre></TechnicalDetails>
    </div>}
    <Modal title={`Khóa kỳ công ${lockDecision?.code ?? ""}?`} open={Boolean(lockDecision)} onCancel={() => !lock.isPending && setLockDecision(undefined)} onOk={() => { if (lockDecision && lockTokenCurrent) lock.mutate(lockDecision.input); }} okText="Khóa kỳ công — không mở lại" cancelText="Tiếp tục rà soát" confirmLoading={lock.isPending} okButtonProps={{ disabled: !lockTokenCurrent || busy }} maskClosable={false}>
      {lockDecision && <p>Lưu nguồn của {lockDecision.summary.workshops} xưởng, {number.format(lockDecision.summary.workUnits)} công và {number.format(lockDecision.summary.overtimeEligibleMinutes)} phút OT đủ điều kiện{lockDecision.initialization ? " của kỳ khởi tạo" : ""}. Sau khóa, không trả kỳ về Mở và không sửa nguồn này.</p>}
      {!lockTokenCurrent && <Alert type="warning" showIcon message="Phiên bản rà soát đã thay đổi" description="Đóng hộp này, tải lại và rà soát lại trước khi khóa. Không tự gửi lại bằng nguồn mới." />}
      {lock.isError && <Alert type="error" showIcon message="Chưa khóa kỳ công" description={errorMessage(lock.error)} />}
    </Modal>
    <Modal title="Trả kỳ công về Mở trước khóa" open={Boolean(returnToken)} onCancel={() => !sendBack.isPending && setReturnToken(undefined)} onOk={() => returnForm.submit()} okText="Trả kỳ về Mở" cancelText="Giữ kỳ đã chốt" confirmLoading={sendBack.isPending} okButtonProps={{ disabled: !returnTokenCurrent || busy }} destroyOnHidden>
      <Alert type="warning" showIcon message="Không xóa bản chốt xưởng cũ" description="Kỳ trở về Mở, QĐ phải trả riêng xưởng cần sửa. TT xác nhận lại dữ liệu đổi và QĐ chốt lại trước khi khóa." />
      <Form form={returnForm} layout="vertical" onFinish={value => { if (returnToken && returnTokenCurrent) sendBack.mutate({ ...returnToken, reason: value.reason.trim() }); }}><Form.Item name="reason" label="Lý do trả kỳ" rules={[{ required: true, whitespace: true, message: "Nhập lý do trả kỳ trước khóa." }]}><Input.TextArea aria-label="Lý do trả kỳ trước khóa" rows={3} maxLength={2000} /></Form.Item></Form>
      {!returnTokenCurrent && <Alert type="warning" showIcon message="Nguồn hoặc phiên bản kỳ đã đổi; tải lại trước khi trả kỳ." />}
      {sendBack.isError && <Alert type="error" showIcon message="Chưa trả kỳ công" description={errorMessage(sendBack.error)} />}
    </Modal>
    <Drawer title="Nguồn công đã khóa" width={screens.lg ? 1180 : "100%"} open={sourceOpen} onClose={() => setSourceOpen(false)} destroyOnHidden>
      {current?.lockedSource && <div className="team-confirmation-stack"><Alert type="info" showIcon message="Bản nguồn bất biến — không phải dữ liệu tính lại" description={`Khóa bởi ${current.lockedSource.actor.displayName} · ${dateTime.format(new Date(current.lockedSource.occurredAt))}. Giờ OT là nguồn công, chưa phải tiền OT hoặc bảng lương.`} /><LockedSourceRecords snapshot={current.lockedSource.snapshot} /></div>}
    </Drawer>
    <Drawer title="Bản lưu lịch sử kỳ công" width={screens.lg ? 1180 : "100%"} open={Boolean(history)} onClose={() => setHistory(undefined)} destroyOnHidden>
      {history && <div className="team-confirmation-stack"><Descriptions bordered size="small" column={1} items={[
        { key: "action", label: "Thao tác / phiên bản kỳ", children: `${history.action === "LOCK" ? "Khóa kỳ công" : "Trả kỳ về Mở"} · ${history.revision}` },
        { key: "actor", label: "Người thực hiện", children: history.actor.displayName },
        { key: "time", label: "Thời điểm", children: dateTime.format(new Date(history.occurredAt)) },
        { key: "reason", label: "Lý do / ghi chú", children: history.note || "Không có ghi chú" },
      ]} /><Alert type="info" showIcon message="Bản lưu bất biến tại thời điểm thao tác" />{history.snapshot.schemaVersion === 1 && history.snapshot.teams ? <LockedSourceRecords snapshot={history.snapshot as PeriodLockSnapshot} /> : <TechnicalDetails title="Chi tiết kỹ thuật bản lưu"><pre>{JSON.stringify(history.snapshot, null, 2)}</pre></TechnicalDetails>}</div>}
    </Drawer>
  </section>;
}
