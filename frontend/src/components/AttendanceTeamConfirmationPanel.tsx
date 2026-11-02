import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Empty, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { AuthUser } from "../api/hrtp";
import { ApiError, errorMessage } from "../api/client";
import { attendanceConfirmationsApi } from "../api/attendance-confirmations";
import type { SourceCoverageInput, TeamConfirmationCorrection, TeamConfirmationDay, TeamConfirmationIssue, TeamConfirmationOvertime, TeamConfirmationReview } from "../api/attendance-confirmations";
import { TechnicalDetails } from "./TechnicalDetails";

const { Text, Title } = Typography;
const { TextArea } = Input;

export type TeamConfirmationNavigationTarget = "daily" | "raw" | "overtime" | "corrections";

type IssuePresentation = {
  title: string;
  action: string;
  owner: string;
  target?: TeamConfirmationNavigationTarget;
  button: string;
};

const ISSUE_PRESENTATIONS: Record<string, IssuePresentation> = {
  PERIOD_FROZEN: { title: "Kỳ công đã chốt hoặc khóa", action: "Kiểm tra trạng thái kỳ công trước khi xác nhận.", owner: "Bộ phận quản lý kỳ công", button: "Mở bảng công", target: "daily" },
  PERIOD_NOT_OPEN: { title: "Kỳ công chưa mở", action: "Mở kỳ công theo quy trình trước khi xác nhận.", owner: "Bộ phận quản lý kỳ công", button: "Mở bảng công", target: "daily" },
  NO_SCHEDULES: { title: "Chưa có lịch làm việc đã duyệt", action: "Tổ trưởng lập lịch, Quản đốc duyệt lịch làm việc cho tổ.", owner: "Tổ trưởng và Quản đốc", button: "Mở bảng công", target: "daily" },
  UNPROCESSED_DAY: { title: "Ngày công chưa được xử lý", action: "Xử lý công từ dữ liệu lượt quẹt và lịch đã duyệt.", owner: "Admin chấm công", target: "daily", button: "Mở bảng công" },
  STALE_ATTENDANCE: { title: "Kết quả công cần cập nhật", action: "Xử lý lại công theo dữ liệu hiện hành.", owner: "Admin chấm công", target: "daily", button: "Mở bảng công" },
  INVALID_WORK_UNITS: { title: "Số công quy đổi chưa hợp lệ", action: "Rà soát công quy đổi và xử lý lại ngày công.", owner: "Admin chấm công", target: "daily", button: "Mở bảng công" },
  UNEXPLAINED_ERROR: { title: "Ngày công thiếu giải trình đã duyệt", action: "Bổ sung và phê duyệt giải trình cho ngày công.", owner: "Nhân sự và người duyệt giải trình", target: "corrections", button: "Mở giải trình" },
  ATTENDANCE_EXCEPTION: { title: "Ngoại lệ công cần rà soát", action: "Rà soát ngoại lệ trước khi xác nhận; cảnh báo này không chặn xác nhận.", owner: "Tổ trưởng", target: "daily", button: "Mở bảng công" },
  EMPLOYMENT_INVALID: { title: "Công phát sinh ngoài thời gian làm việc", action: "Rà soát hồ sơ nhân sự và xử lý lại công nếu cần.", owner: "Admin nhân sự và chấm công", target: "daily", button: "Mở bảng công" },
  ORPHAN_ATTENDANCE: { title: "Kết quả công không còn lịch đã duyệt", action: "Rà soát lịch làm việc và xử lý lại kết quả công.", owner: "Admin chấm công", target: "daily", button: "Mở bảng công" },
  STALE_OVERTIME: { title: "OT thực tế cần cập nhật", action: "Xử lý lại OT theo đề nghị, lượt quẹt và giải trình hiện hành.", owner: "Admin chấm công", target: "overtime", button: "Mở OT thực tế" },
  OVERTIME_ERROR: { title: "OT còn thiếu hoặc mơ hồ lượt quẹt", action: "Bổ sung giải trình được duyệt hoặc xử lý lại lượt quẹt OT.", owner: "Nhân sự, người duyệt giải trình và Admin chấm công", target: "overtime", button: "Mở OT thực tế" },
  OVERTIME_EXCEPTION: { title: "Ngoại lệ OT cần rà soát", action: "Rà soát OT trước khi xác nhận; cảnh báo này không chặn xác nhận.", owner: "Tổ trưởng", target: "overtime", button: "Mở OT thực tế" },
  UNRESOLVED_LEAVE: { title: "Chưa thể xác nhận: hồ sơ nghỉ chưa hoàn tất", action: "Hoàn tất xử lý đơn nghỉ trong kỳ, sau đó tải lại để kiểm tra.", owner: "Người lập đơn và người duyệt đơn nghỉ", button: "" },
  UNRESOLVED_OVERTIME: { title: "Đề nghị OT chưa hoàn tất", action: "Hoàn thiện và phê duyệt đề nghị OT trong kỳ.", owner: "Tổ trưởng và Quản đốc", target: "overtime", button: "Mở OT thực tế" },
  UNRESOLVED_CORRECTION: { title: "Chưa thể xác nhận: giải trình chưa hoàn tất", action: "Hoàn tất xử lý giải trình trong kỳ, sau đó tải lại để kiểm tra.", owner: "Tổ trưởng và người duyệt giải trình", target: "corrections", button: "Mở giải trình" },
  COLLECTION_WINDOW_OPEN: { title: "Chưa kết thúc thời gian thu nhận chấm công", action: "Chờ kết thúc thời gian thu nhận chấm công rồi tải lại để kiểm tra.", owner: "Tổ trưởng", button: "" },
  UNROUTED_PUNCH: { title: "Lượt chấm công chưa được ghép ca", action: "Admin cần kiểm tra và ghép các lượt chấm công chưa xác định được ca.", owner: "Admin chấm công", target: "raw", button: "Mở lượt quẹt gốc" },
  SOURCE_COVERAGE_MISSING: { title: "Admin chưa xác nhận đủ dữ liệu chấm công", action: "Admin đối chiếu tệp hoặc chứng từ và xác nhận đã nhận đủ dữ liệu cho kỳ.", owner: "Admin chấm công", button: "" },
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Nháp", PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Trả lại", REJECTED: "Từ chối", CANCELLED: "Đã hủy",
  ACCEPTED: "Đã tiếp nhận", ACCEPTED_WITH_EXCEPTIONS: "Đã tiếp nhận có ngoại lệ", PROCESSING: "Đang xử lý", FAILED: "Lỗi xử lý",
};

const FLAG_LABELS: Record<string, string> = {
  MISSING_IN: "Thiếu lượt vào", MISSING_OUT: "Thiếu lượt ra", MISSING_PUNCH: "Thiếu lượt quẹt", LATE: "Đi muộn", EARLY: "Về sớm", ABSENT: "Vắng mặt", AMBIGUOUS: "Mơ hồ", UNAPPROVED_WORK: "Làm ngoài khoảng duyệt", APPROVED_NOT_WORKED: "Đã duyệt nhưng thiếu giờ thực tế", UNMATCHED_PUNCH: "Lượt quẹt chưa xác định", AWAITING_PUNCHES: "Chờ lượt quẹt", INVALID_PAIR: "Cặp quẹt không hợp lệ",
};

function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Bằng chứng xác nhận công tổ" />;
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

function vietnamLocalOffset(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00+07:00` : undefined;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Cần rà soát trạng thái";
}

function technicalValue(label: string, value: string | null | undefined) {
  return value ? <div><Text strong>{label}: </Text><code>{value}</code></div> : null;
}

function issueDetails(item: TeamConfirmationIssue, index: number) {
  return <TechnicalDetails title="Chi tiết kỹ thuật nguồn"><div>{technicalValue("Mã sự cố", item.code)}{technicalValue("Nhân sự", item.employeeId)}{technicalValue("Ngày công", item.workDate)}{technicalValue("Nguồn", item.sourceId)}{technicalValue("Thông điệp gốc", item.message)}<Text type="secondary">Bản ghi {index + 1}</Text></div></TechnicalDetails>;
}

function issues(
  items: TeamConfirmationIssue[],
  type: "error" | "warning",
  empty: string,
  review: TeamConfirmationReview,
  onNavigate?: (target: TeamConfirmationNavigationTarget, employeeCode?: string, sourceId?: string) => void,
  canViewRaw = false,
) {
  if (!items.length) return <Text type="secondary">{empty}</Text>;
  const people = new Map(review.snapshot.roster.map(person => [person.id, person]));
  const grouped = new Map<string, { item: TeamConfirmationIssue; sourceIds: string[]; count: number; records: TeamConfirmationIssue[] }>();
  for (const item of items) {
    const groupKey = `${item.code}\u0000${item.employeeId ?? ""}\u0000${item.workDate ?? ""}`;
    const group = grouped.get(groupKey);
    if (group) {
      group.count += 1;
      group.records.push(item);
      if (item.sourceId) group.sourceIds.push(item.sourceId);
    } else {
      grouped.set(groupKey, { item, sourceIds: item.sourceId ? [item.sourceId] : [], count: 1, records: [item] });
    }
  }
  return <ul className="team-confirmation-issues">{[...grouped.values()].map((group, index) => {
    const presentation = ISSUE_PRESENTATIONS[group.item.code] ?? { title: "Vấn đề cần rà soát", action: "Kiểm tra nguồn liên quan cùng người phụ trách công trước khi xác nhận.", owner: "Người phụ trách công", button: "" };
    const person = group.item.employeeId ? people.get(group.item.employeeId) : undefined;
    const correctionItems = group.item.code === "UNRESOLVED_CORRECTION" ? review.corrections.filter(correction => group.sourceIds.includes(correction.id)).flatMap(correction => correction.items ?? []) : [];
    const leavePeople = group.item.code === "UNRESOLVED_LEAVE" ? review.leaves.filter(leave => group.sourceIds.includes(leave.id)).map(leave => leave.employeeId) : [];
    const overtimeItems = group.item.code === "UNRESOLVED_OVERTIME" ? review.overtime.filter(row => row.requestIds.some(id => group.sourceIds.includes(id))) : [];
    const relatedPeople = [...new Set([...(person ? [person.id] : []), ...correctionItems.map(item => item.employeeId), ...leavePeople, ...overtimeItems.map(item => item.employeeId)])].flatMap(id => { const person = people.get(id); return person ? [person] : []; });
    const relatedDates = [...new Set([...(group.item.workDate ? [group.item.workDate] : []), ...correctionItems.map(item => item.workDate.slice(0, 10)), ...overtimeItems.map(item => item.workDate)])];
    const sourceId = group.item.code === "UNRESOLVED_CORRECTION" ? group.sourceIds[0] : undefined;
    const relatedFlags = group.item.code === "OVERTIME_EXCEPTION" || group.item.code === "OVERTIME_ERROR"
      ? review.overtime.filter(row => row.employeeId === group.item.employeeId && row.workDate === group.item.workDate).flatMap(row => row.flags)
      : group.item.code === "ATTENDANCE_EXCEPTION" || group.item.code === "UNEXPLAINED_ERROR"
        ? review.days.filter(row => row.employee.id === group.item.employeeId && row.workDate === group.item.workDate).flatMap(row => row.flags) : [];
    return <li key={`${group.item.code}-${group.item.employeeId ?? "all"}-${group.item.workDate ?? "all"}`}>
      <Tag color={type === "error" ? "error" : "warning"}>{presentation.title}</Tag>
      <div><Text strong>{presentation.action}</Text></div>
      <div><Text type="secondary">Phụ trách: {presentation.owner}{relatedPeople.length ? ` · ${relatedPeople.map(person => `${person.code} · ${person.fullName}`).join("; ")}` : ""}{relatedDates.length ? ` · Ngày công ${relatedDates.join(", ")}` : ""}{group.count > 1 ? ` · ${group.count} trường hợp` : ""}</Text></div>
      {relatedFlags.length > 0 && <div>{[...new Set(relatedFlags)].map(flag => <Tag key={flag}>{FLAG_LABELS[flag] ?? "Ngoại lệ cần rà soát"}</Tag>)}</div>}
      {group.item.code === "COLLECTION_WINDOW_OPEN" && <div>Thu nhận đến {vietnamTime(review.collection.until)}.</div>}
      {presentation.target && onNavigate && (presentation.target !== "raw" || canViewRaw) && <Button type="link" size="small" onClick={() => onNavigate(presentation.target!, person?.code, sourceId)}>{presentation.button}</Button>}
      <TechnicalDetails title={group.records.length > 1 ? `Chi tiết kỹ thuật ${group.records.length} nguồn` : "Chi tiết kỹ thuật nguồn"}>
        {group.records.map((record, recordIndex) => <div key={`${record.code}-${record.sourceId ?? recordIndex}`}>{issueDetails(record, recordIndex)}</div>)}
      </TechnicalDetails>
    </li>;
  })}</ul>;
}

function EvidenceTables({ review, onNavigate }: { review: TeamConfirmationReview; onNavigate?: (target: TeamConfirmationNavigationTarget, employeeCode?: string, sourceId?: string) => void }) {
  const people = useMemo(() => new Map(review.snapshot.roster.map(person => [person.id, person])), [review.snapshot.roster]);
  const personName = (id: string) => { const person = people.get(id); return person ? <span><strong>{person.code}</strong><br /><Text type="secondary">{person.fullName}</Text></span> : <Text type="secondary">Không có thông tin nhân sự trong phạm vi</Text>; };
  const days = useMemo<ColumnsType<TeamConfirmationDay>>(() => [
    { title: "Ngày", dataIndex: "workDate", width: 110 },
    { title: "Nhân sự", width: 205, render: (_, row) => <span><strong>{row.employee.code}</strong><br /><Text type="secondary">{row.employee.fullName}</Text></span> },
    { title: "Ca làm việc", width: 215, render: (_, row) => <span>{row.shiftCode}<TechnicalDetails title="Chi tiết kỹ thuật">{technicalValue("Nguồn lịch", row.scheduleId)}</TechnicalDetails></span> },
    { title: "Công", width: 104, align: "right", render: (_, row) => <span>{row.workUnits}<br /><Text type="secondary">{minutes(row.workedMinutes)}</Text></span> },
    { title: "Nghỉ đã duyệt", width: 225, render: (_, row) => row.leave.sources.length ? <span>{row.leave.symbols.join(", ") || "Nghỉ"}<br /><Text type="secondary">{minutes(row.leave.minutes)} · {row.leave.sources.length} nguồn nghỉ</Text><TechnicalDetails title="Chi tiết kỹ thuật nguồn nghỉ">{row.leave.sources.map(source => <div key={source.requestId}>{technicalValue("Hồ sơ", source.requestId)}</div>)}</TechnicalDetails></span> : "—" },
    { title: "Ngoại lệ / giải trình", width: 250, render: (_, row) => <span>{row.flags.length ? row.flags.map(flag => <Tag className="attendance-state" color="warning" key={flag}>{FLAG_LABELS[flag] ?? "Ngoại lệ công"}</Tag>) : <Tag color="success">Đủ</Tag>}<br />{row.correctionId ? <span><Text type="secondary">Đã áp dụng giải trình</Text><TechnicalDetails title="Chi tiết kỹ thuật">{technicalValue("Giải trình", row.correctionId)}</TechnicalDetails></span> : <Text type="secondary">Không có giải trình</Text>}</span> },
  ], []);
  const overtime = useMemo<ColumnsType<TeamConfirmationOvertime>>(() => [
    { title: "Ngày", dataIndex: "workDate", width: 110 },
    { title: "Nhân sự", dataIndex: "employeeId", width: 220, render: personName },
    { title: "Phê duyệt / thực tế / đủ điều kiện", width: 220, render: (_, row) => <span>{minutes(row.approvedMinutes)} / {minutes(row.actualMinutes)} / {minutes(row.eligibleMinutes)}<br /><Text type="secondary">{row.requestIds.length ? `${row.requestIds.length} đề nghị OT liên quan` : "Không có đề nghị OT"}</Text><TechnicalDetails title="Chi tiết kỹ thuật đề nghị OT">{row.requestIds.map(id => <div key={id}>{technicalValue("Đề nghị", id)}</div>)}</TechnicalDetails></span> },
    { title: "Điều chỉnh", width: 180, render: (_, row) => row.adjustmentId ? <span>Có điều chỉnh đã áp dụng<TechnicalDetails title="Chi tiết kỹ thuật">{technicalValue("Điều chỉnh", row.adjustmentId)}</TechnicalDetails></span> : "Không có" },
    { title: "Ngoại lệ OT", dataIndex: "flags", width: 260, render: flags => flags.length ? flags.map((flag: string) => <Tag className="attendance-state" color="warning" key={flag}>{FLAG_LABELS[flag] ?? "Ngoại lệ OT"}</Tag>) : <Tag color="success">Đủ</Tag> },
  ], [people]);
  const leaves = useMemo<ColumnsType<TeamConfirmationReview["leaves"][number]>>(() => [
    { title: "Nhân sự", dataIndex: "employeeId", width: 260, render: personName },
    { title: "Trạng thái", dataIndex: "status", width: 180, render: status => statusLabel(status) },
    { title: "Phiên bản", dataIndex: "revision", width: 110, align: "right" },
    { title: "Thông tin kỹ thuật", width: 180, render: (_, row) => <TechnicalDetails>{technicalValue("Hồ sơ nghỉ", row.id)}</TechnicalDetails> },
  ], [people]);
  const corrections = useMemo<ColumnsType<TeamConfirmationCorrection>>(() => [
    { title: "Người liên quan", width: 240, render: (_, row) => { const ids = [...new Set((row.items ?? []).map(item => item.employeeId))]; return ids.length ? <>{ids.map(id => <div key={id}>{personName(id)}</div>)}</> : <Text type="secondary">Không có thông tin nhân sự trong phạm vi</Text>; } },
    { title: "Ngày công liên quan", width: 170, render: (_, row) => { const dates = [...new Set((row.items ?? []).map(item => item.workDate.slice(0, 10)))]; return dates.length ? dates.join(", ") : "—"; } },
    { title: "Trạng thái", dataIndex: "status", width: 150, render: status => statusLabel(status) },
    { title: "Nội dung", width: 310, render: (_, row) => <span>{row.reason}<br /><Text type="secondary">{[row.evidenceReference, row.incidentReference].filter(Boolean).join(" · ") || "Không có tham chiếu nghiệp vụ"}</Text>{onNavigate && <Button type="link" size="small" onClick={() => onNavigate("corrections", undefined, row.id)}>Mở giải trình</Button>}</span> },
    { title: "Phiên bản", dataIndex: "revision", width: 110, align: "right" },
    { title: "Thông tin kỹ thuật", width: 180, render: (_, row) => <TechnicalDetails>{technicalValue("Giải trình", row.id)}{technicalValue("Loại", row.kind)}{row.evidence?.map(evidence => <div key={evidence.id}>{technicalValue("Bằng chứng", evidence.id)}{technicalValue("Mã băm", evidence.sha256)}</div>)}</TechnicalDetails> },
  ], [people, onNavigate]);

  return <div className="team-confirmation-evidence">
    <section aria-labelledby="team-confirmation-days"><Title level={3} id="team-confirmation-days">Công theo lịch đã duyệt</Title><div className="table-panel"><Table<TeamConfirmationDay> rowKey="scheduleId" size="small" components={{ body: { wrapper: TableBody } }} columns={days} dataSource={review.days} pagination={false} scroll={{ x: 1210 }} locale={{ emptyText: "Không có ngày công trong phạm vi tổ." }} /></div></section>
    <section aria-labelledby="team-confirmation-overtime"><Title level={3} id="team-confirmation-overtime">OT thực tế</Title><div className="table-panel"><Table<TeamConfirmationOvertime> rowKey={row => `${row.employeeId}-${row.workDate}`} size="small" components={{ body: { wrapper: TableBody } }} columns={overtime} dataSource={review.overtime} pagination={false} scroll={{ x: 990 }} locale={{ emptyText: "Không có OT thực tế trong kỳ." }} /></div></section>
    <section aria-labelledby="team-confirmation-leaves"><Title level={3} id="team-confirmation-leaves">Hồ sơ nghỉ trong phạm vi</Title><div className="table-panel"><Table<TeamConfirmationReview["leaves"][number]> rowKey="id" size="small" components={{ body: { wrapper: TableBody } }} columns={leaves} dataSource={review.leaves} pagination={false} scroll={{ x: 730 }} locale={{ emptyText: "Không có hồ sơ nghỉ." }} /></div></section>
    <section aria-labelledby="team-confirmation-corrections"><Title level={3} id="team-confirmation-corrections">Giải trình / điều chỉnh</Title><div className="table-panel"><Table<TeamConfirmationCorrection> rowKey="id" size="small" components={{ body: { wrapper: TableBody } }} columns={corrections} dataSource={review.corrections} pagination={false} scroll={{ x: 1160 }} locale={{ emptyText: "Không có giải trình hoặc điều chỉnh." }} /></div></section>
  </div>;
}

export function TeamConfirmationEvidence({ review, onNavigate }: { review: TeamConfirmationReview; onNavigate?: (target: TeamConfirmationNavigationTarget, employeeCode?: string, sourceId?: string) => void }) {
  return <div className="team-confirmation-stack">
    <div className="team-confirmation-columns">
      <section className="team-confirmation-card"><Title level={3}>Việc cần xử lý của tổ</Title>{issues(review.blockers, "error", "Không còn điều kiện chặn.", review, onNavigate)}</section>
      <section className="team-confirmation-card"><Title level={3}>Cảnh báo của tổ</Title>{issues(review.warnings, "warning", "Không có cảnh báo.", review, onNavigate)}</section>
    </div>
    <Descriptions size="small" bordered column={1} items={[
      { key: "collection", label: "Thu nhận dữ liệu đến", children: vietnamTime(review.collection.until) },
      { key: "coverage", label: "Căn cứ đủ nguồn", children: review.coverage ? <><Tag color={review.coverage.valid ? "success" : "warning"}>{review.coverage.valid ? "Đủ nguồn" : "Cần xác nhận lại"}</Tag>{review.coverage.reference}<br />{review.coverage.actor.displayName} · {vietnamTime(review.coverage.createdAt)}</> : "Admin chưa xác nhận đủ nguồn" },
      { key: "files", label: "Tệp nguồn", children: review.collection.batches.map(batch => <div key={batch.id}>{batch.fileName} · {batch.totalRows} dòng</div>) },
    ]} />
    <EvidenceTables review={review} onNavigate={onNavigate} />
  </div>;
}

export function AttendanceTeamConfirmationPanel({ user, periodId, onNavigate }: { user: AuthUser; periodId: string; onNavigate?: (target: "daily" | "raw" | "overtime" | "corrections", employeeCode?: string, sourceId?: string) => void }) {
  const client = useQueryClient();
  const [modal, contextHolder] = Modal.useModal();
  const [teamId, setTeamId] = useState<string>();
  const [reviewed, setReviewed] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [coveredFrom, setCoveredFrom] = useState("");
  const [coveredUntil, setCoveredUntil] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [batchIds, setBatchIds] = useState<string[]>([]);

  const isTT = user.roles.includes("TT") && user.permissions.includes("attendance.confirm");
  const isAD = user.roles.includes("AD") && user.permissions.includes("attendance.import");
  const teams = useQuery({ queryKey: ["attendance-confirmation-teams", periodId], queryFn: () => attendanceConfirmationsApi.teams(periodId) });
  const review = useQuery({
    queryKey: ["attendance-team-confirmation", periodId, teamId],
    queryFn: () => attendanceConfirmationsApi.review({ periodId, teamOrgUnitId: teamId! }),
    enabled: Boolean(teamId),
  });

  const resetAcknowledgements = () => {
    setReviewed(false);
    setWarningsAcknowledged(false);
    setNote("");
  };
  const resetCoverage = () => {
    setCoveredFrom("");
    setCoveredUntil("");
    setReference("");
    setReason("");
    setBatchIds([]);
  };
  const reload = () => {
    resetAcknowledgements();
    resetCoverage();
    void review.refetch();
  };

  useEffect(() => {
    setTeamId(undefined);
    resetAcknowledgements();
    resetCoverage();
  }, [periodId]);

  useEffect(() => {
    resetAcknowledgements();
    resetCoverage();
  }, [teamId, review.data?.sourceHash, review.data?.revision]);

  const showConflict = (error: unknown, action: string) => {
    if (error instanceof ApiError && error.status === 409) {
      modal.warning({
        title: "Dữ liệu đã thay đổi — cần xác nhận lại",
        content: `${action} không được thực hiện vì nguồn hoặc phiên bản không còn hiện hành. Tải lại để rà soát lại toàn bộ dữ liệu.`,
        okText: "Tải lại",
        onOk: reload,
      });
      return;
    }
  };

  const coverage = useMutation({
    mutationFn: (input: SourceCoverageInput) => attendanceConfirmationsApi.coverage(input),
    onSuccess: () => {
      resetCoverage();
      resetAcknowledgements();
      void client.invalidateQueries({ queryKey: ["attendance-team-confirmation", periodId, teamId] });
    },
    onError: error => showConflict(error, "Xác nhận đủ nguồn"),
  });
  const confirm = useMutation({
    mutationFn: () => attendanceConfirmationsApi.confirm({
      periodId,
      teamOrgUnitId: teamId!,
      revision: review.data!.revision,
      sourceHash: review.data!.sourceHash,
      reviewed: true,
      acknowledgeWarnings: warningsAcknowledged,
      note: note.trim() || undefined,
    }),
    onSuccess: () => {
      resetAcknowledgements();
      void client.invalidateQueries({ queryKey: ["attendance-team-confirmation", periodId, teamId] });
    },
    onError: error => showConflict(error, "Xác nhận công tổ"),
  });

  const submitCoverage = () => {
    const current = review.data;
    const from = vietnamLocalOffset(coveredFrom);
    const until = vietnamLocalOffset(coveredUntil);
    if (!current || !from || !until || !reference.trim() || !reason.trim()) return;
    coverage.mutate({
      periodId,
      teamOrgUnitId: teamId!,
      revision: current.coverage?.revision ?? 0,
      sourceHash: current.collection.sourceHash,
      coveredFrom: from,
      coveredUntil: until,
      reference: reference.trim(),
      reason: reason.trim(),
      batchIds,
    });
  };

  const current = review.data;
  const coverageFormValid = Boolean(vietnamLocalOffset(coveredFrom) && vietnamLocalOffset(coveredUntil) && reference.trim() && reason.trim());
  const canSubmit = Boolean(isTT && current?.canConfirm && reviewed && warningsAcknowledged && !confirm.isPending);

  return <section className="team-confirmation" aria-labelledby="team-confirmation-title">
    {contextHolder}
    <div className="team-confirmation-toolbar">
      <div><Title level={2} id="team-confirmation-title">Xác nhận tổ</Title><Text type="secondary">Đối chiếu công, OT, nghỉ, giải trình và căn cứ nguồn theo đúng tổ trong phạm vi được cấp.</Text></div>
      <Space wrap><Button onClick={reload} disabled={!teamId} loading={review.isFetching}>Tải lại</Button></Space>
    </div>
    <div className="team-confirmation-picker">
      <label htmlFor="team-confirmation-team">Tổ trong phạm vi</label>
      <Select id="team-confirmation-team" aria-label="Tổ trong phạm vi" virtual={false} getPopupContainer={trigger => trigger.parentElement!} loading={teams.isLoading} value={teamId} onChange={setTeamId} placeholder="Chọn tổ để rà soát" options={teams.data?.items.map(team => ({ value: team.id, label: `${team.code} · ${team.name}` }))} notFoundContent={teams.isError ? "Không tải được danh sách tổ" : undefined} />
    </div>
    {teams.isError && <Alert type="error" showIcon message="Không tải được tổ trong phạm vi" description={errorMessage(teams.error)} />}
    {!teams.isLoading && !teams.isError && teams.data?.items.length === 0 && <Empty description="Không có tổ nào trong phạm vi của bạn ở kỳ này." />}
    {!teamId && teams.data?.items.length ? <Alert type="info" showIcon message="Chọn một tổ để tải đối soát và lịch sử xác nhận." /> : null}
    {teamId && review.isLoading && <div className="content-loading"><Spin tip="Đang rà soát nguồn công tổ…" /></div>}
    {teamId && review.isError && <Alert type="error" showIcon message="Không tải được đối soát tổ" description={errorMessage(review.error)} action={<Button size="small" onClick={reload}>Tải lại</Button>} />}
    {current && <div className="team-confirmation-stack">
      <div className="team-confirmation-status">
        <Tag color={current.state === "CONFIRMED" ? "success" : current.state === "STALE" ? "warning" : "processing"}>{current.state === "CONFIRMED" ? "Đã xác nhận" : current.state === "STALE" ? "Dữ liệu đã thay đổi — cần xác nhận lại" : "Chờ xác nhận"}</Tag>
        <Text strong>{current.team.code} · {current.team.name}</Text>
        <Text type="secondary">Kỳ {current.period.code} · Phiên bản xác nhận {current.revision}</Text>
      </div>
      <Descriptions className="team-confirmation-summary" bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[
        { key: "employees", label: "Nhân sự", children: current.summary.employees },
        { key: "days", label: "Ca đã duyệt / đã xử lý", children: `${current.summary.scheduledDays} / ${current.summary.processedDays}` },
        { key: "work", label: "Công / thời gian", children: `${current.summary.workUnits.toLocaleString("vi-VN")} · ${minutes(current.summary.workedMinutes)}` },
        { key: "leave", label: "Nghỉ đã duyệt", children: `${current.summary.approvedLeaveRequests} hồ sơ · ${minutes(current.summary.leaveMinutes)}` },
        { key: "overtime", label: "OT duyệt / đủ điều kiện", children: `${minutes(current.summary.overtimeApprovedMinutes)} / ${minutes(current.summary.overtimeEligibleMinutes)}` },
        { key: "blockers", label: "Điều kiện chặn", children: <Tag color={current.blockers.length ? "error" : "success"}>{current.blockers.length}</Tag> },
        { key: "warnings", label: "Cảnh báo", children: <Tag color={current.warnings.length ? "warning" : "success"}>{current.warnings.length}</Tag> },
      ]} />
      <div className="team-confirmation-columns">
        <section className="team-confirmation-card" aria-labelledby="team-confirmation-blockers"><Title level={3} id="team-confirmation-blockers">Việc cần xử lý trước khi xác nhận</Title>{issues(current.blockers, "error", "Không có điều kiện chặn.", current, onNavigate, isAD)}</section>
        <section className="team-confirmation-card" aria-labelledby="team-confirmation-warnings"><Title level={3} id="team-confirmation-warnings">Cảnh báo cần rà soát</Title>{current.warnings.length > 0 && <Alert type="warning" showIcon message="Cảnh báo không chặn xác nhận, nhưng Tổ trưởng phải xác nhận đã đọc." />}{issues(current.warnings, "warning", "Không có cảnh báo.", current, onNavigate, isAD)}</section>
      </div>
      <section className="team-confirmation-card" aria-labelledby="team-confirmation-collection">
        <Title level={3} id="team-confirmation-collection">Căn cứ nguồn</Title>
        <Descriptions size="small" column={{ xs: 1, md: 2 }} items={[
          { key: "window", label: "Dữ liệu lượt quẹt được thu đến", children: vietnamTime(current.collection.until) },
          { key: "required-batches", label: "Lô nguồn liên quan", children: current.collection.requiredBatchIds.length ? `${current.collection.requiredBatchIds.length} lô đã đối chiếu` : "Không có lượt quẹt; Admin vẫn phải ghi chứng từ căn cứ." },
          { key: "coverage", label: "Xác nhận nguồn của Admin", span: 2, children: current.coverage ? <span><Tag color={current.coverage.valid ? "success" : "error"}>{current.coverage.valid ? "Đủ nguồn" : "Cần xác nhận lại"}</Tag> · Phiên bản {current.coverage.revision} · {current.coverage.actor.displayName} · {vietnamTime(current.coverage.createdAt)}<br />{vietnamTime(current.coverage.coveredFrom)} – {vietnamTime(current.coverage.coveredUntil)} · {current.coverage.reference}<br /><Text type="secondary">{current.coverage.reason}</Text><TechnicalDetails>{technicalValue("Xác nhận nguồn", current.coverage.id)}{technicalValue("Mã băm nguồn", current.coverage.sourceHash)}{current.coverage.batchIds.map(batchId => <div key={batchId}>{technicalValue("Lô nguồn", batchId)}</div>)}</TechnicalDetails></span> : <Text type="danger">Admin chưa xác nhận đủ nguồn theo chứng từ và khoảng bao phủ.</Text> },
        ]} />
        <div className="table-panel team-confirmation-batches"><Table rowKey="id" size="small" components={{ body: { wrapper: TableBody } }} columns={[{ title: "Tệp", dataIndex: "fileName", width: 350 }, { title: "Trạng thái", dataIndex: "status", width: 180, render: statusLabel }, { title: "Dòng", dataIndex: "totalRows", width: 90, align: "right" as const }, { title: "Thông tin kỹ thuật", width: 220, render: (_: unknown, batch) => <TechnicalDetails>{technicalValue("Lô nguồn", batch.id)}{technicalValue("Mã băm tệp", batch.fileHash)}</TechnicalDetails> }]} dataSource={current.collection.batches} pagination={false} scroll={{ x: 840 }} locale={{ emptyText: "Không có lô dữ liệu liên quan; không suy diễn dữ liệu, dùng chứng từ đã nêu." }} /></div>
        <TechnicalDetails title="Chi tiết kỹ thuật căn cứ nguồn">{technicalValue("Mã băm căn cứ", current.collection.sourceHash)}{technicalValue("Thu từ", current.collection.from)}{technicalValue("Thu đến", current.collection.until)}</TechnicalDetails>
      </section>
      <EvidenceTables review={current} onNavigate={onNavigate} />
      {isAD && <section className="team-confirmation-card" aria-labelledby="team-confirmation-coverage-form">
        <Title level={3} id="team-confirmation-coverage-form">Admin xác nhận đủ nguồn</Title>
        <Alert type="info" showIcon message="Ghi rõ chứng từ và lý do đã nhận đủ dữ liệu chấm công." description="Nhập giờ Việt Nam (UTC+07:00), bao gồm toàn bộ khoảng thời gian cần thu nhận dữ liệu ở trên. Nếu không có lượt chấm công, không chọn tệp nhưng vẫn phải ghi chứng từ." />
        <div className="team-confirmation-form">
          <label>Nhận dữ liệu từ (giờ Việt Nam)<Input type="datetime-local" value={coveredFrom} onChange={event => setCoveredFrom(event.target.value)} aria-label="Nhận dữ liệu từ giờ Việt Nam" /></label>
          <label>Nhận dữ liệu đến (giờ Việt Nam)<Input type="datetime-local" value={coveredUntil} onChange={event => setCoveredUntil(event.target.value)} aria-label="Nhận dữ liệu đến giờ Việt Nam" /></label>
          <label>Chứng từ / tham chiếu<Input value={reference} maxLength={500} onChange={event => setReference(event.target.value)} aria-label="Chứng từ hoặc tham chiếu" /></label>
          <label>Lý do<TextArea value={reason} maxLength={2000} rows={2} onChange={event => setReason(event.target.value)} aria-label="Lý do đủ nguồn" /></label>
          <div className="team-confirmation-batch-picker"><Text strong>Lô nguồn đã đối chiếu</Text><Checkbox.Group value={batchIds} onChange={values => setBatchIds(values as string[])} options={current.collection.batches.map(batch => ({ value: batch.id, label: batch.fileName }))} /></div>
          <div className="team-confirmation-form-actions"><Button type="primary" loading={coverage.isPending} disabled={!coverageFormValid} onClick={submitCoverage}>Xác nhận đủ nguồn</Button></div>
        </div>
        {coverage.isError && <Alert className="team-confirmation-feedback" type="error" showIcon message="Không xác nhận được đủ nguồn" description={errorMessage(coverage.error)} />}
      </section>}
      {isTT && <section className="team-confirmation-card" aria-labelledby="team-confirmation-confirm-form">
        <Title level={3} id="team-confirmation-confirm-form">TT xác nhận công tổ</Title>
        {!current.canConfirm && <Alert type={current.state === "CONFIRMED" ? "info" : "warning"} showIcon message={current.state === "CONFIRMED" ? "Nguồn hiện hành đã được xác nhận" : "Chưa đủ điều kiện xác nhận"} description={current.state === "CONFIRMED" ? "Khi dữ liệu thay đổi, trạng thái sẽ tự chuyển thành cần xác nhận lại; hãy rà soát trước khi xác nhận phiên bản mới." : "Khắc phục toàn bộ điều kiện chặn, rồi tải lại trước khi xác nhận."} />}
        <div className="team-confirmation-confirm-form">
          <Checkbox checked={reviewed} onChange={event => setReviewed(event.target.checked)}>Tôi đã rà soát toàn bộ bằng chứng công, OT, nghỉ, giải trình và căn cứ nguồn ở trên.</Checkbox>
          <Checkbox checked={warningsAcknowledged} onChange={event => setWarningsAcknowledged(event.target.checked)}>Tôi đã đọc và chấp nhận các cảnh báo hiện có (nếu có).</Checkbox>
          <label>Ghi chú (tùy chọn)<TextArea value={note} maxLength={2000} rows={3} onChange={event => setNote(event.target.value)} aria-label="Ghi chú xác nhận tổ" /></label>
          <div className="team-confirmation-form-actions"><Button type="primary" loading={confirm.isPending} disabled={!canSubmit} onClick={() => confirm.mutate()}>Xác nhận công tổ</Button></div>
        </div>
        {confirm.isError && <Alert className="team-confirmation-feedback" type="error" showIcon message="Không xác nhận được công tổ" description={errorMessage(confirm.error)} />}
      </section>}
      {!isAD && !isTT && <Alert type="info" showIcon message="Chế độ chỉ đọc" description="QĐ/KT chỉ xem đối soát và lịch sử xác nhận; không có thao tác xác nhận hoặc chốt/khóa kỳ tại đây." />}
      <section className="team-confirmation-card" aria-labelledby="team-confirmation-history"><Title level={3} id="team-confirmation-history">Lịch sử xác nhận bất biến</Title><div className="table-panel"><Table<TeamConfirmationReview["history"][number]> rowKey="id" size="small" components={{ body: { wrapper: TableBody } }} columns={[{ title: "Phiên bản", dataIndex: "revision", width: 110, align: "right" }, { title: "Người xác nhận", width: 220, render: (_, row) => row.actor.displayName }, { title: "Thời điểm", dataIndex: "confirmedAt", width: 190, render: vietnamTime }, { title: "Ghi chú", dataIndex: "note", width: 350, render: value => value || "—" }, { title: "Thông tin kỹ thuật", width: 220, render: (_, row) => <TechnicalDetails>{technicalValue("Xác nhận", row.id)}{technicalValue("Mã băm nguồn", row.sourceHash)}</TechnicalDetails> }]} dataSource={current.history} pagination={false} scroll={{ x: 930 }} locale={{ emptyText: "Chưa có lần xác nhận nào." }} /></div></section>
    </div>}
  </section>;
}
