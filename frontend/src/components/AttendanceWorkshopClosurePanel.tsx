import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Grid, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { AuthUser } from "../api/hrtp";
import { ApiError, errorMessage } from "../api/client";
import { attendanceConfirmationsApi } from "../api/attendance-confirmations";
import { workshopClosuresApi } from "../api/workshop-closures";
import type { WorkshopClosureHistory, WorkshopClosureInput, WorkshopClosureIssue, WorkshopClosureTeam } from "../api/workshop-closures";
import { TeamConfirmationEvidence } from "./AttendanceTeamConfirmationPanel";
import type { TeamConfirmationNavigationTarget } from "./AttendanceTeamConfirmationPanel";
import { TechnicalDetails } from "./TechnicalDetails";

const { Text, Title } = Typography;
const stateLabels = { WAITING: "Chờ chốt", CLOSED: "Xưởng đã chốt", STALE: "Nguồn đã đổi — cần rà soát lại", RETURNED: "Đã trả lại để bổ sung" };
const teamLabels = { WAITING: "Chưa xác nhận", CONFIRMED: "Đã xác nhận", STALE: "Xác nhận đã lỗi thời" };
const blockerLabels: Record<string, string> = {
  "XC-01": "Nghỉ đã duyệt nhưng vẫn có chấm công", "XC-02": "OT đã duyệt thiếu dữ liệu ra vào", "XC-03": "Có lượt quẹt nhưng chưa có lịch ca", "XC-04": "Thời gian làm việc vượt trần ngày", "XC-05": "Chấm công khác cơ sở cần đối chiếu thời gian di chuyển",
  "XC-06": "Công quy đổi âm hoặc vượt số ngày của kỳ", "XC-07": "Phát sinh công sau khi nghỉ việc", "XC-08": "Hợp đồng chưa hiệu lực hoặc đã hết hạn khi phát sinh công", "XC-09": "Ngày công lỗi chưa có giải trình", "XC-10": "OT lũy kế chạm hoặc vượt trần tháng/năm",
  TEAM_NOT_CONFIRMED: "Tổ chưa xác nhận dữ liệu hiện hành", TEAM_CONFIRMATION_MISSING: "Tổ chưa xác nhận công", TEAM_CONFIRMATION_STALE: "Nguồn công tổ đã đổi, cần xác nhận lại",
  NO_TEAMS: "Chưa có tổ đủ căn cứ để lập bảng công", NO_SCHEDULES: "Chưa có lịch ca đã duyệt", PERIOD_NOT_OPEN: "Kỳ công chưa mở hoặc đã chốt", PERIOD_FROZEN: "Kỳ công đã chốt hoặc khóa",
  SOURCE_COVERAGE_MISSING: "Admin cần xác nhận đủ tệp hoặc chứng từ nguồn", COLLECTION_WINDOW_OPEN: "Chưa kết thúc thời gian thu nhận chấm công", UNROUTED_PUNCH: "Admin cần ghép các lượt quẹt chưa xác định ca",
  UNPROCESSED_DAY: "Admin cần xử lý ngày công", STALE_ATTENDANCE: "Cần xử lý lại công theo nguồn hiện hành", STALE_OVERTIME: "Cần xử lý lại OT thực tế", OVERTIME_ERROR: "OT còn thiếu hoặc mơ hồ lượt quẹt",
  UNEXPLAINED_ERROR: "Ngày công cần giải trình được duyệt", UNRESOLVED_CORRECTION: "Giải trình chưa hoàn tất", UNRESOLVED_LEAVE: "Đơn nghỉ chưa hoàn tất", UNRESOLVED_OVERTIME: "Đề nghị OT chưa hoàn tất",
  INVALID_WORK_UNITS: "Số công quy đổi chưa hợp lệ", EMPLOYMENT_INVALID: "Công ngoài thời gian làm việc của nhân sự", ORPHAN_ATTENDANCE: "Kết quả công không còn lịch đã duyệt",
  NO_RELEVANT_TEAMS: "Chưa có tổ phát sinh nguồn công trong kỳ", LEGAL_PARAMETERS_INVALID: "Thiếu hoặc không hợp lệ tham số giới hạn công, OT theo ngày hiệu lực", ATTENDANCE_EXCEPTION: "Ngoại lệ ngày công cần rà soát", OVERTIME_EXCEPTION: "Ngoại lệ OT cần rà soát",
};
function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Đối soát công phân xưởng" />;
}
function time(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}
function amount(value: number): string { return value.toLocaleString("vi-VN", { maximumFractionDigits: 6 }); }

export function AttendanceWorkshopClosurePanel({ user, periodId, initialWorkshopId, onNavigate }: {
  user: AuthUser;
  periodId: string;
  initialWorkshopId?: string;
  onNavigate: (target: TeamConfirmationNavigationTarget, employeeCode?: string, sourceId?: string) => void;
}) {
  const client = useQueryClient();
  const screens = Grid.useBreakpoint();
  const [closeInput, setCloseInput] = useState<WorkshopClosureInput>();
  const [workshopId, setWorkshopId] = useState<string | undefined>(initialWorkshopId);
  const [teamId, setTeamId] = useState<string>();
  const [reviewed, setReviewed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [history, setHistory] = useState<WorkshopClosureHistory>();
  const [returnForm] = Form.useForm<{ reason: string }>();
  const isQD = user.roles.includes("QD") && user.permissions.includes("attendance.review");
  const workshops = useQuery({ queryKey: ["attendance-workshops", periodId], queryFn: () => workshopClosuresApi.workshops(periodId) });
  const review = useQuery({
    queryKey: ["attendance-workshop-closure", periodId, workshopId],
    queryFn: () => workshopClosuresApi.review({ periodId, workshopOrgUnitId: workshopId! }), enabled: Boolean(workshopId),
  });
  const evidence = useQuery({
    queryKey: ["attendance-team-confirmation", periodId, teamId],
    queryFn: () => attendanceConfirmationsApi.review({ periodId, teamOrgUnitId: teamId! }), enabled: Boolean(teamId), staleTime: 0,
  });
  const current = review.data;
  useEffect(() => {
    setReviewed(false); setAcknowledged(false); setNote(""); setReturnOpen(false); setCloseInput(undefined); returnForm.resetFields();
  }, [workshopId, current?.sourceHash, current?.revision, returnForm]);
  const refresh = () => {
    setReviewed(false); setAcknowledged(false);
    void client.invalidateQueries({ queryKey: ["attendance-workshop-closure", periodId] });
    void client.invalidateQueries({ queryKey: ["attendance-period-lock", periodId] });
    void client.invalidateQueries({ queryKey: ["attendance-team-confirmation", periodId] });
    void client.invalidateQueries({ queryKey: ["attendance-context"] });
    void client.invalidateQueries({ queryKey: ["attendance-periods"] });
  };
  const onFailure = (error: unknown) => {
    setReviewed(false); setAcknowledged(false);
    if (error instanceof ApiError && error.status === 409) refresh();
  };
  const close = useMutation({
    mutationFn: (input: WorkshopClosureInput) => workshopClosuresApi.close(input),
    onSuccess: () => { setCloseInput(undefined); refresh(); }, onError: onFailure,
  });
  const sendBack = useMutation({
    mutationFn: ({ reason }: { reason: string }) => workshopClosuresApi.return({ periodId, workshopOrgUnitId: workshopId!, revision: current!.revision, sourceHash: current!.sourceHash, reason: reason.trim() }),
    onSuccess: () => { setReturnOpen(false); returnForm.resetFields(); close.reset(); refresh(); }, onError: onFailure,
  });
  const busy = review.isFetching || close.isPending || sendBack.isPending;
  const canClose = isQD && current?.canClose && reviewed && (!current.warnings.length || acknowledged) && !busy;
  const navigate = (target: TeamConfirmationNavigationTarget, employeeCode?: string, sourceId?: string) => {
    setTeamId(undefined); onNavigate(target, employeeCode, sourceId);
  };
  const teamColumns: ColumnsType<WorkshopClosureTeam> = [
    { title: "Tổ", width: 230, render: (_, row) => <><strong>{row.team.code}</strong><span className="table-subtext">{row.team.name}</span></> },
    { title: "Xác nhận của Tổ trưởng", width: 195, render: (_, row) => <><Tag color={row.state === "CONFIRMED" ? "success" : "warning"}>{teamLabels[row.state]}</Tag><span className="table-subtext">Phiên bản {row.revision}</span></> },
    { title: "Công / nhân sự", width: 140, align: "right", render: (_, row) => <>{amount(row.summary.workUnits)} công<span className="table-subtext">{row.summary.employees} người · {row.summary.processedDays}/{row.summary.scheduledDays} ca</span></> },
    { title: "OT duyệt / thực tế / đủ điều kiện", width: 220, align: "right", render: (_, row) => <>{amount(row.summary.overtimeApprovedMinutes)} / {amount(row.summary.overtimeActualMinutes)} / {amount(row.summary.overtimeEligibleMinutes)} phút</> },
    { title: "Nghỉ đã duyệt", width: 160, align: "right", render: (_, row) => <>{row.summary.approvedLeaveRequests} hồ sơ<span className="table-subtext">{amount(row.summary.leaveMinutes)} phút</span></> },
    { title: "Việc cần xử lý / cảnh báo", width: 180, render: (_, row) => <Space wrap><Tag color={row.blockers.length ? "error" : "success"}>{row.blockers.length} chặn</Tag><Tag color={row.warnings.length ? "warning" : "default"}>{row.warnings.length} cảnh báo</Tag></Space> },
    { title: "Đối soát", width: 130, render: (_, row) => <Button size="small" onClick={() => setTeamId(row.team.id)}>Rà soát tổ</Button> },
  ];
  const showIssues = (items: WorkshopClosureIssue[]) => {
    const groups = new Map<string, WorkshopClosureIssue[]>();
    for (const issue of items) { const key = issue.teamOrgUnitId ?? "workshop"; const group = groups.get(key); if (group) group.push(issue); else groups.set(key, [issue]); }
    return <ul className="team-confirmation-issues">{[...groups].map(([id, records]) => <li key={id}>
      <Text strong>{records[0].teamName ?? current?.teams.find(row => row.team.id === id)?.team.name ?? "Điều kiện chung"}</Text>
      <div>{[...new Set(records.map(issue => blockerLabels[issue.code] ?? "Cần rà soát căn cứ công trước khi chốt"))].join("; ")}.</div>
      {records.some(issue => issue.employeeCode || issue.workDate) && <ul>{records.filter(issue => issue.employeeCode || issue.workDate).map((issue, index) => <li key={index}>{[issue.employeeCode, issue.employeeName].filter(Boolean).join(" · ")}{issue.workDate ? ` · Ngày công ${issue.workDate}` : ""} · {blockerLabels[issue.code] ?? "Cần rà soát nguồn liên quan"}</li>)}</ul>}
      {id !== "workshop" && <Button type="link" size="small" onClick={() => setTeamId(id)}>Xem nhân viên, ngày công và nguồn liên quan</Button>}
      <TechnicalDetails><pre>{JSON.stringify(records, null, 2)}</pre></TechnicalDetails>
    </li>)}</ul>;
  };
  return <section className="team-confirmation workshop-closure" aria-labelledby="workshop-closure-title">

    <div className="team-confirmation-toolbar"><div><Title level={2} id="workshop-closure-title">Chốt công phân xưởng</Title><Text type="secondary">Rà soát các tổ đã xác nhận trước khi chốt. Chốt xưởng không phải khóa kỳ công của Kế toán.</Text></div><Button disabled={!workshopId || close.isPending || sendBack.isPending} loading={review.isFetching} onClick={refresh}>Tải lại</Button></div>
    <div className="team-confirmation-picker"><label htmlFor="workshop-closure-select">Phân xưởng trong phạm vi</label><Select id="workshop-closure-select" aria-label="Phân xưởng trong phạm vi" virtual={false} loading={workshops.isLoading} value={workshopId} placeholder="Chọn phân xưởng để đối soát" onChange={id => { setWorkshopId(id); setTeamId(undefined); setHistory(undefined); close.reset(); sendBack.reset(); }} options={workshops.data?.items.map(workshop => ({ value: workshop.id, label: `${workshop.code} · ${workshop.name}` }))} /></div>
    {workshops.isError && <Alert type="error" showIcon message="Không tải được phân xưởng" description={errorMessage(workshops.error)} action={<Button onClick={() => void workshops.refetch()}>Thử lại</Button>} />}
    {workshops.isSuccess && workshops.data.items.length === 0 && <Empty description="Không có phân xưởng có công trong phạm vi kỳ và quyền của bạn." />}
    {!workshopId && Boolean(workshops.data?.items.length) && <Alert type="info" showIcon message="Chọn phân xưởng để xem các tổ, điều kiện chốt và lịch sử." />}
    {review.isLoading && workshopId && <Spin tip="Đang kiểm tra nguồn và xác nhận các tổ…"><div className="workshop-loading" /></Spin>}
    {review.isError && <Alert type="error" showIcon message="Không tải được đối soát phân xưởng" description={errorMessage(review.error)} action={<Button onClick={refresh}>Tải lại</Button>} />}
    {current && !review.isError && <div className="team-confirmation-stack">
      <div className="team-confirmation-status"><Tag color={current.state === "CLOSED" ? "success" : current.state === "STALE" ? "warning" : "processing"}>{stateLabels[current.state]}</Tag><Text strong>{current.workshop.code} · {current.workshop.name}</Text><Text type="secondary">Kỳ {current.period.code} · {current.period.dateFrom} — {current.period.dateTo} · Phiên bản {current.revision}</Text><Tag>{current.period.status === "OPEN" ? "Kỳ đang mở" : current.period.status === "CLOSED" ? "Kỳ đã chốt, chưa khóa" : current.period.status === "LOCKED" ? "Kỳ đã khóa" : "Kỳ chưa mở"}</Tag></div>
      <Descriptions className="team-confirmation-summary" size="small" bordered column={{ xs: 1, sm: 2, xl: 4 }} items={[
        { key: "teams", label: "Tổ đã xác nhận", children: `${current.teams.filter(row => row.state === "CONFIRMED").length} / ${current.teams.length}` },
        { key: "people", label: "Nhân sự / ca", children: `${current.summary.employees} người · ${current.summary.processedDays}/${current.summary.scheduledDays} ca` },
        { key: "work", label: "Công / làm việc", children: `${amount(current.summary.workUnits)} công · ${amount(current.summary.workedMinutes)} phút` },
        { key: "leave", label: "Nghỉ đã duyệt", children: `${current.summary.approvedLeaveRequests} hồ sơ · ${amount(current.summary.leaveMinutes)} phút` },
        { key: "overtime", label: "OT duyệt / thực tế / đủ điều kiện", span: 2, children: `${amount(current.summary.overtimeApprovedMinutes)} / ${amount(current.summary.overtimeActualMinutes)} / ${amount(current.summary.overtimeEligibleMinutes)} phút` },
        { key: "blockers", label: "Việc cần xử lý", children: <Tag color={current.blockers.length ? "error" : "success"}>{current.blockers.length}</Tag> },
        { key: "warnings", label: "Cảnh báo", children: current.warnings.length },
      ]} />
      {current.state === "STALE" && <Alert showIcon type="warning" message="Nguồn đã thay đổi sau lần chốt trước" description="Đối chiếu lại nguồn, xử lý công và xác nhận lại các tổ bị ảnh hưởng. Bản chốt cũ vẫn được lưu trong lịch sử." />}
      <section className="team-confirmation-card"><Title level={3}>Việc cần xử lý trước khi chốt</Title>{current.blockers.length ? showIssues(current.blockers) : <Text type="secondary">Không còn điều kiện chặn. Rà soát dữ liệu và các cảnh báo trước khi chốt.</Text>}</section>
      <div className="table-panel"><Table<WorkshopClosureTeam> rowKey={row => row.team.id} components={{ body: { wrapper: TableBody } }} size="small" columns={teamColumns} dataSource={current.teams} scroll={{ x: 1355 }} pagination={{ pageSize: 20, showSizeChanger: false }} locale={{ emptyText: "Không có tổ có công cần chốt." }} /></div>
      {current.warnings.length > 0 && <section className="team-confirmation-card"><Title level={3}>Cảnh báo cần Quản đốc rà soát</Title><Alert type="warning" showIcon message={`${current.warnings.length} cảnh báo cần đọc và xác nhận`} description="Cảnh báo không tự động chặn chốt. Đối chiếu nhân viên, ngày công và nguồn liên quan trước khi quyết định." />{showIssues(current.warnings)}</section>}
      {isQD ? <section className="team-confirmation-card workshop-closure-actions"><Title level={3}>Quyết định của Quản đốc</Title>
        {current.state !== "CLOSED" && <div className="team-confirmation-confirm-form">
          <Checkbox checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={!current.canClose || busy}>Tôi đã đối chiếu công, OT, nghỉ, giải trình và xác nhận của tất cả tổ.</Checkbox>
          {current.warnings.length > 0 && <Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={!current.canClose || busy}>Tôi đã rà soát các cảnh báo và nguồn liên quan.</Checkbox>}
          <label>Ghi chú chốt xưởng<Input.TextArea aria-label="Ghi chú chốt xưởng" rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} disabled={!current.canClose || busy} /></label>
          <Button type="primary" disabled={!canClose} loading={close.isPending} onClick={() => {
            const input: WorkshopClosureInput = { periodId, workshopOrgUnitId: current.workshop.id, revision: current.revision, sourceHash: current.sourceHash, reviewed: true, acknowledgeWarnings: acknowledged, note: note.trim() || undefined };
            setCloseInput(input);
          }}>Chốt công phân xưởng</Button>
        </div>}
        {current.canReturn && <Button onClick={() => { sendBack.reset(); setReturnOpen(true); }} disabled={busy}>Trả lại xưởng để bổ sung</Button>}
        {current.state === "CLOSED" && !current.canReturn && <Alert type="info" showIcon message="Kỳ đã chốt hoặc khóa — không sửa trực tiếp" description="Kỳ đã chốt chỉ được Kế toán trả lại trước khóa theo quy trình; kỳ đã khóa không được mở lại." />}
        {close.isError && <Alert type="error" showIcon message="Chưa chốt công phân xưởng" description={errorMessage(close.error)} />}
        {close.isSuccess && <Alert type="success" showIcon message="Đã lưu bản chốt công phân xưởng" />}
      </section> : <Alert type="info" showIcon message="Chế độ chỉ đọc" description="Chỉ Quản đốc có quyền chốt hoặc trả lại phân xưởng trong phạm vi được giao." />}
      <section className="team-confirmation-card"><Title level={3}>Lịch sử chốt và trả lại</Title><div className="table-panel"><Table<WorkshopClosureHistory> rowKey="id" size="small" components={{ body: { wrapper: TableBody } }} dataSource={current.history} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 950 }} columns={[
        { title: "Phiên bản", dataIndex: "revision", width: 100, align: "right" }, { title: "Thao tác", width: 135, render: (_, row) => <Tag color={row.action === "CLOSE" ? "success" : "warning"}>{row.action === "CLOSE" ? "Chốt xưởng" : "Trả lại"}</Tag> },
        { title: "Người thực hiện", width: 210, render: (_, row) => row.actor.displayName }, { title: "Thời điểm", dataIndex: "occurredAt", width: 175, render: time }, { title: "Lý do / ghi chú", dataIndex: "note", width: 220 }, { title: "Bản lưu", width: 110, render: (_, row) => <Button size="small" onClick={() => setHistory(row)}>Xem bản lưu</Button> },
      ]} locale={{ emptyText: "Chưa có lần chốt hoặc trả lại." }} /></div></section>
      <TechnicalDetails><div>Phân xưởng: {current.workshop.id}</div><div>Dấu kiểm tra nguồn: {current.sourceHash}</div></TechnicalDetails>
    </div>}
    <Drawer title="Đối soát công tổ trước khi chốt xưởng" width={screens.md ? 1050 : "100%"} open={Boolean(teamId)} onClose={() => setTeamId(undefined)} destroyOnHidden>
      {evidence.isFetching ? <Spin /> : evidence.isError ? <Alert type="error" showIcon message="Không tải được căn cứ công tổ" description={errorMessage(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>Tải lại</Button>} /> : evidence.data && <div className="team-confirmation-stack"><Title level={2}>{evidence.data.team.code} · {evidence.data.team.name}</Title><Tag>{teamLabels[evidence.data.state]}</Tag><Text>Phiên bản xác nhận {evidence.data.revision}</Text><TeamConfirmationEvidence review={evidence.data} onNavigate={navigate} /></div>}
    </Drawer>
    <Modal title={`Chốt công ${current?.workshop.name ?? "phân xưởng"}?`} open={Boolean(closeInput)} onCancel={() => !close.isPending && setCloseInput(undefined)} onOk={() => { if (closeInput) close.mutate(closeInput); }} okText="Chốt công phân xưởng" cancelText="Tiếp tục rà soát" confirmLoading={close.isPending} maskClosable={false}>
      <p>Chốt {current?.teams.length} tổ, {amount(current?.summary.workUnits ?? 0)} công của kỳ {current?.period.code}. Sau chốt, phải trả lại xưởng theo quyền trước khi sửa. Khi mọi xưởng đủ điều kiện, kỳ chuyển sang Đã chốt; không tự khóa kỳ.</p>
      {close.isError && <Alert type="error" showIcon message="Chưa chốt công phân xưởng" description={errorMessage(close.error)} />}
    </Modal>
    <Modal title="Trả lại phân xưởng để bổ sung" open={returnOpen} onCancel={() => !sendBack.isPending && setReturnOpen(false)} onOk={() => returnForm.submit()} okText="Trả lại xưởng" cancelText="Giữ bản chốt" confirmLoading={sendBack.isPending} destroyOnHidden>
      <Alert type="warning" showIcon message="Chỉ thực hiện khi kỳ đang mở" description="Bản chốt cũ được giữ nguyên trong lịch sử. Sau bổ sung, tổ phải xác nhận lại dữ liệu thay đổi và Quản đốc chốt lại." />
      <Form form={returnForm} layout="vertical" onFinish={value => sendBack.mutate(value)}><Form.Item name="reason" label="Lý do trả lại" rules={[{ required: true, whitespace: true, message: "Nhập lý do trả lại xưởng." }]}><Input.TextArea aria-label="Lý do trả lại xưởng" rows={3} maxLength={2000} /></Form.Item></Form>
      {sendBack.isError && <Alert type="error" showIcon message="Chưa trả lại xưởng" description={errorMessage(sendBack.error)} />}
    </Modal>
    <Drawer title="Bản lưu lịch sử chốt phân xưởng" width={screens.md ? 760 : "100%"} open={Boolean(history)} onClose={() => setHistory(undefined)} destroyOnHidden>{history && <><Descriptions size="small" bordered column={1} items={[
      { key: "revision", label: "Phiên bản", children: history.revision }, { key: "action", label: "Thao tác", children: history.action === "CLOSE" ? "Chốt xưởng" : "Trả lại xưởng" }, { key: "actor", label: "Người thực hiện", children: history.actor.displayName }, { key: "date", label: "Thời điểm", children: time(history.occurredAt) }, { key: "note", label: "Ghi chú / lý do", children: history.note || "Không có ghi chú" },
      ...(history.snapshot?.summary ? [{ key: "totals", label: "Số liệu tại thời điểm lưu", children: `${amount(history.snapshot.summary.workUnits)} công · ${history.snapshot.summary.employees} nhân sự · ${amount(history.snapshot.summary.overtimeEligibleMinutes)} phút OT đủ điều kiện · ${amount(history.snapshot.summary.leaveMinutes)} phút nghỉ` }] : []),
    ]} /><Alert className="attendance-alert" type="info" showIcon message="Bản lưu bất biến tại thời điểm thao tác, không phải dữ liệu hiện hành." /><TechnicalDetails title="Chi tiết kỹ thuật bản lưu"><pre>{JSON.stringify({ id: history.id, sourceHash: history.sourceHash, snapshot: history.snapshot }, null, 2)}</pre></TechnicalDetails></>}</Drawer>
  </section>;
}
