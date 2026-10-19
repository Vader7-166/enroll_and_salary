import { DownloadOutlined, EditOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Descriptions, Divider, Drawer, Empty, Form, Grid, Input, Modal, Pagination, Radio, Space, Spin, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import type { AuthUser } from "../api/hrtp";
import { errorMessage } from "../api/client";
import { correctionsApi } from "../api/corrections";
import type { Correction, CorrectionInput, CorrectionItem, CorrectionKind, CorrectionStatus, CorrectionTarget } from "../api/corrections";

const { Text } = Typography;
const PAGE_SIZE = 20;
const STATUS_LABEL: Record<CorrectionStatus, string> = {
  DRAFT: "Nháp", PENDING: "Chờ duyệt", RETURNED: "Trả lại", REJECTED: "Từ chối", APPROVED: "Đã duyệt",
};
const STATUS_COLOR: Record<CorrectionStatus, string> = {
  DRAFT: "default", PENDING: "processing", RETURNED: "warning", REJECTED: "error", APPROVED: "success",
};
const HISTORY_LABEL: Record<string, string> = {
  CREATE: "Tạo", UPDATE: "Cập nhật", SUBMIT: "Gửi duyệt", APPROVE: "Duyệt", RETURN: "Trả lại", REJECT: "Từ chối", ADD_EVIDENCE: "Thêm bằng chứng",
};
const SNAPSHOT_FIELD_LABEL: Record<string, string> = {
  checkInAt: "Giờ vào hiệu lực", checkOutAt: "Giờ ra hiệu lực", workedMinutes: "Phút làm việc", dayMinutes: "Phút ban ngày", nightMinutes: "Phút ban đêm", lateMinutes: "Phút đi muộn", earlyMinutes: "Phút về sớm", absent: "Vắng mặt", workUnits: "Đơn vị công", flags: "Cờ chấm công",
  requestedMinutes: "Phút đăng ký", approvedMinutes: "Phút đã duyệt", actualMinutes: "Phút thực tế", eligibleMinutes: "Phút đủ điều kiện", unapprovedMinutes: "Phút ngoài duyệt", unworkedApprovedMinutes: "Phút đã duyệt chưa làm",
};
const SNAPSHOT_FLAGS: Record<string, string> = {
  MISSING_IN: "Thiếu lượt vào", MISSING_OUT: "Thiếu lượt ra", MISSING_PUNCH: "Thiếu lượt quẹt", LATE: "Đi muộn", EARLY: "Về sớm", ABSENT: "Vắng mặt", AMBIGUOUS: "Không xác định ca", UNAPPROVED_WORK: "Làm ngoài khoảng duyệt", APPROVED_NOT_WORKED: "Đã duyệt nhưng thiếu giờ thực tế", UNMATCHED_PUNCH: "Quẹt chưa xác định", AWAITING_PUNCHES: "Chờ lượt quẹt", INVALID_PAIR: "Cặp quẹt không hợp lệ",
};
const DAILY_SNAPSHOT_FIELDS = ["checkInAt", "checkOutAt", "workedMinutes", "dayMinutes", "nightMinutes", "lateMinutes", "earlyMinutes", "absent", "workUnits", "flags"];
const ACTUAL_SNAPSHOT_FIELDS = ["requestedMinutes", "approvedMinutes", "actualMinutes", "eligibleMinutes", "dayMinutes", "nightMinutes", "unapprovedMinutes", "unworkedApprovedMinutes", "flags"];
const SNAPSHOT_TIME_FIELDS: Record<string, true> = { checkInAt: true, checkOutAt: true };
const SNAPSHOT_MINUTE_FIELDS: Record<string, true> = { workedMinutes: true, dayMinutes: true, nightMinutes: true, lateMinutes: true, earlyMinutes: true, requestedMinutes: true, approvedMinutes: true, actualMinutes: true, eligibleMinutes: true, unapprovedMinutes: true, unworkedApprovedMinutes: true };

type DraftInterval = { startAt: string; endAt: string };
type DraftItem = { target: CorrectionTarget; intervals: DraftInterval[]; excuseLateEarly: boolean };
type EditorValues = { kind: CorrectionKind; reason: string; evidenceReference?: string; incidentReference?: string };

function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} tabIndex={0} aria-label="Dữ liệu giải trình chấm công" />;
}

function vietnamTime(value: string | null | undefined): string {
  if (!value) return "Chưa có dữ liệu";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short", hour12: false,
  }).format(date);
}

function toVietnamInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function toVietnamOffset(value: string): string {
  return `${value}:00+07:00`;
}

function targetKey(target: Pick<CorrectionTarget, "employee" | "orgUnitId" | "workDate">): string {
  return `${target.employee.id}:${target.orgUnitId}:${target.workDate}`;
}

function correctionItemToDraft(item: CorrectionItem): DraftItem {
  return {
    target: {
      employee: item.employee,
      orgUnitId: item.orgUnitId,
      orgUnitCode: item.orgUnitCode,
      workDate: item.workDate,
      daily: item.before?.daily ?? null,
      actual: item.before?.actual ?? null,
    },
    intervals: item.intervals?.map(interval => ({ startAt: toVietnamInput(interval.startAt), endAt: toVietnamInput(interval.endAt) })) ?? [],
    excuseLateEarly: item.excuseLateEarly,
  };
}

function statusTag(status: CorrectionStatus) {
  return <Tag className="attendance-state" color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>;
}

type SnapshotEntry = { field: string; value: string };

function snapshotEntries(snapshot: Record<string, unknown> | null, fields: string[]): SnapshotEntry[] {
  if (!snapshot) return [];
  return fields.flatMap(field => {
    const value = snapshot[field];
    if (value === undefined || value === null) return [];
    if (SNAPSHOT_TIME_FIELDS[field]) return [{ field, value: vietnamTime(String(value)) }];
    if (SNAPSHOT_MINUTE_FIELDS[field]) {
      const minuteValue = Number(value);
      return [{ field, value: Number.isFinite(minuteValue) ? minuteValue.toLocaleString("vi-VN") + " phút" : String(value) }];
    }
    if (field === "absent") return [{ field, value: value ? "Có" : "Không" }];
    if (field === "flags") return [{ field, value: Array.isArray(value) && value.length ? value.map(flag => SNAPSHOT_FLAGS[String(flag)] ?? String(flag)).join(", ") : "Không có" }];
    return [{ field, value: String(value) }];
  });
}

function SnapshotView({ value, title }: { value: { daily: Record<string, unknown> | null; actual: Record<string, unknown> | null } | null; title: string }) {
  const daily = snapshotEntries(value?.daily ?? null, DAILY_SNAPSHOT_FIELDS);
  const actual = snapshotEntries(value?.actual ?? null, ACTUAL_SNAPSHOT_FIELDS);
  if (!value || (!daily.length && !actual.length)) return <Text type="secondary">{title}: Chưa có dữ liệu</Text>;
  return <div className="correction-snapshot">
    <Text strong>{title}</Text>
    <Descriptions size="small" bordered column={1}>
      {daily.map(entry => <Descriptions.Item key={"daily-" + entry.field} label={"Công · " + SNAPSHOT_FIELD_LABEL[entry.field]}>{entry.value}</Descriptions.Item>)}
      {actual.map(entry => <Descriptions.Item key={"actual-" + entry.field} label={"OT · " + SNAPSHOT_FIELD_LABEL[entry.field]}>{entry.value}</Descriptions.Item>)}
    </Descriptions>
  </div>;
}

function CorrectionEditor({
  correction,
  periodId,
  orgUnitId,
  onClose,
  onSaved,
}: {
  correction: Correction | null;
  periodId: string;
  orgUnitId?: string;
  onClose: () => void;
  onSaved: (correction: Correction) => void;
}) {
  const [form] = Form.useForm<EditorValues>();
  const [workDate, setWorkDate] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [targetPage, setTargetPage] = useState(1);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [evidenceFile, setEvidenceFile] = useState<File>();
  const [localError, setLocalError] = useState<string>();
  const editing = Boolean(correction);
  const targetQuery = useQuery({
    queryKey: ["attendance-correction-targets", periodId, workDate, orgUnitId, targetSearch, targetPage],
    queryFn: () => correctionsApi.targets({ periodId, workDate, orgUnitId, search: targetSearch || undefined, page: targetPage, pageSize: PAGE_SIZE }),
    enabled: Boolean(workDate),
  });

  useEffect(() => {
    if (!correction) {
      form.setFieldsValue({ kind: "CORRECTION", reason: "", evidenceReference: "", incidentReference: "" });
      setWorkDate("");
      setItems([]);
      setEvidenceFile(undefined);
      return;
    }
    form.setFieldsValue({
      kind: correction.kind,
      reason: correction.reason,
      evidenceReference: correction.evidenceReference ?? "",
      incidentReference: correction.incidentReference ?? "",
    });
    setWorkDate(correction.items[0]?.workDate ?? "");
    setItems(correction.items.map(correctionItemToDraft));
    setEvidenceFile(undefined);
  }, [correction, form]);

  const save = useMutation({
    mutationFn: async ({ values, submit }: { values: EditorValues; submit: boolean }) => {
      if (!items.length) throw new Error("Chọn ít nhất một ngày công cần giải trình.");
      if (items.length > 1 && !values.incidentReference?.trim()) throw new Error("Giải trình nhiều người phải có mã sự việc chung.");
      if (items.length > 1 && new Set(items.map(item => item.target.orgUnitId)).size > 1) throw new Error("Giải trình hàng loạt chỉ áp dụng cho cùng một đơn vị và ngày công.");
      if (submit && !values.evidenceReference?.trim() && !evidenceFile && !(correction?.evidence.length)) {
        throw new Error("Cần nhập tham chiếu bằng chứng hoặc tải tệp bằng chứng trước khi gửi duyệt.");
      }
      const payload: CorrectionInput = {
        periodId,
        kind: values.kind,
        reason: values.reason.trim(),
        ...(values.evidenceReference?.trim() ? { evidenceReference: values.evidenceReference.trim() } : {}),
        ...(values.incidentReference?.trim() ? { incidentReference: values.incidentReference.trim() } : {}),
        items: items.map(item => ({
          employeeId: item.target.employee.id,
          orgUnitId: item.target.orgUnitId,
          workDate: item.target.workDate,
          intervals: values.kind === "EXPLANATION" ? null : item.intervals.map(interval => ({
            startAt: toVietnamOffset(interval.startAt), endAt: toVietnamOffset(interval.endAt),
          })),
          excuseLateEarly: values.kind === "EXPLANATION" && item.excuseLateEarly,
        })),
      };
      for (const item of payload.items) {
        if (item.intervals?.some(interval => !interval.startAt || !interval.endAt || new Date(interval.endAt).getTime() <= new Date(interval.startAt).getTime())) {
          throw new Error("Mỗi khoảng giờ phải có bắt đầu trước kết thúc.");
        }
      }
      let saved = correction
        ? (await correctionsApi.update(correction.id, { ...payload, revision: correction.revision })).correction
        : (await correctionsApi.create(payload)).correction;
      if (evidenceFile) saved = (await correctionsApi.uploadEvidence(saved.id, evidenceFile)).correction;
      if (submit) saved = (await correctionsApi.submit(saved.id, saved.revision)).correction;
      return saved;
    },
    onSuccess: saved => {
      onSaved(saved);
      onClose();
    },
  });

  const kind = Form.useWatch("kind", form) ?? correction?.kind ?? "CORRECTION";
  const selectedKeys = items.map(item => targetKey(item.target));
  const targetColumns: ColumnsType<CorrectionTarget> = [
    { title: "Nhân sự", key: "employee", width: 220, render: (_, target) => <><strong>{target.employee.fullName}</strong><span className="table-subtext">{target.employee.code}</span></> },
    { title: "Đơn vị", dataIndex: "orgUnitCode", width: 130 },
    { title: "Ngày công", dataIndex: "workDate", width: 120 },
    { title: "Công hiện có", key: "daily", width: 180, render: (_, target) => target.daily ? "Có dữ liệu" : "Chưa có dữ liệu" },
    { title: "OT thực tế", key: "actual", width: 150, render: (_, target) => target.actual ? "Có dữ liệu" : "Không áp dụng" },
  ];
  const setSelected = (targets: CorrectionTarget[]) => {
    const nextKeys = new Set(targets.map(targetKey));
    setItems(previous => {
      const current = new Map(previous.map(item => [targetKey(item.target), item]));
      return targets.map(target => current.get(targetKey(target)) ?? { target, intervals: [], excuseLateEarly: false });
    });
    if (nextKeys.size > 100) setLocalError("Mỗi yêu cầu chỉ được chọn tối đa 100 người.");
    else setLocalError(undefined);
  };
  const updateItem = (key: string, update: (item: DraftItem) => DraftItem) => setItems(previous => previous.map(item => targetKey(item.target) === key ? update(item) : item));
  const uploadList: UploadFile[] = evidenceFile ? [{ uid: evidenceFile.name, name: evidenceFile.name, status: "done", size: evidenceFile.size, type: evidenceFile.type }] : [];

  return <Modal
    title={editing ? "Sửa giải trình chấm công" : "Lập giải trình chấm công"}
    open
    onCancel={onClose}
    footer={null}
    width={1080}
    destroyOnHidden
    className="correction-editor"
  >
    <Form form={form} layout="vertical" onFinish={values => save.mutate({ values, submit: false })}>
      {(save.isError || localError) && <Alert type="error" showIcon message={localError ?? errorMessage(save.error)} className="attendance-alert" />}
      <div className="correction-form-grid">
        <Form.Item label="Loại yêu cầu">
          <div role="radiogroup" aria-label="Loại yêu cầu">
            <Form.Item name="kind" noStyle>
              <Radio.Group disabled={editing} options={[{ value: "CORRECTION", label: "Điều chỉnh giờ công" }, { value: "EXPLANATION", label: "Giải trình" }]} />
            </Form.Item>
          </div>
        </Form.Item>
        <Form.Item label="Ngày công cần chọn" required={!editing}>
          <Input type="date" value={workDate} disabled={editing} onChange={event => { setWorkDate(event.target.value); setTargetPage(1); }} aria-label="Ngày công cần chọn" />
        </Form.Item>
      </div>
      <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: "Nhập lý do giải trình." }]}>
        <Input.TextArea rows={3} maxLength={2000} showCount placeholder="Nêu rõ sự việc thực tế; không tự tạo bằng chứng." />
      </Form.Item>
      <div className="correction-form-grid">
        <Form.Item name="evidenceReference" label="Tham chiếu bằng chứng">
          <Input maxLength={500} placeholder="Số biên bản, mã hồ sơ hoặc đường dẫn đã được lưu trữ" />
        </Form.Item>
        <Form.Item name="incidentReference" label="Mã sự việc chung">
          <Input maxLength={250} placeholder="Bắt buộc khi chọn nhiều người" />
        </Form.Item>
      </div>
      <Form.Item label="Tệp bằng chứng">
        <Upload
          fileList={uploadList}
          beforeUpload={file => { setEvidenceFile(file); return false; }}
          onRemove={() => { setEvidenceFile(undefined); return true; }}
          maxCount={1}
          accept="application/pdf,image/png,image/jpeg,text/plain,.pdf,.png,.jpg,.jpeg,.txt"
        >
          <Button>Tải tệp (PDF, PNG, JPEG, TXT; tối đa 5 MB)</Button>
        </Upload>
        <Text type="secondary">Có thể lưu nháp không kèm bằng chứng; phải có tham chiếu hoặc tệp trước khi gửi duyệt.</Text>
      </Form.Item>
      {!editing && <>
        <Divider orientation="left">Chọn ngày công</Divider>
        <div className="correction-target-tools">
          <Input.Search aria-label="Tìm ngày công cần giải trình" placeholder="Tìm mã hoặc tên nhân viên" value={targetSearch} onChange={event => { setTargetSearch(event.target.value); setTargetPage(1); }} />
          <Text type="secondary">Chọn trong trang hiện tại; mỗi yêu cầu tối đa 100 người.</Text>
        </div>
        {!workDate ? <Alert type="info" showIcon message="Chọn ngày công trước để tìm dữ liệu có thể giải trình." /> : targetQuery.isError ? <Alert type="error" showIcon message="Không tải được dữ liệu cần giải trình" description={errorMessage(targetQuery.error)} /> : <>
          <div className="table-panel attendance-table correction-target-table">
            <Table<CorrectionTarget>
              rowKey={targetKey}
              components={{ body: { wrapper: TableBody } }}
              loading={targetQuery.isLoading || targetQuery.isFetching}
              columns={targetColumns}
              dataSource={targetQuery.data?.items ?? []}
              pagination={false}
              scroll={{ x: 800 }}
              rowSelection={{ selectedRowKeys: selectedKeys, onChange: (_, selected) => setSelected(selected), getCheckboxProps: target => ({ title: target.employee.fullName, "aria-label": `Chọn ${target.employee.code} · ${target.employee.fullName}` }), getTitleCheckboxProps: () => ({ "aria-label": "Chọn tất cả trong trang" }) }}
              locale={{ emptyText: "Không có ngày công phù hợp trong phạm vi được cấp." }}
            />
          </div>
          {targetQuery.data && <Pagination className="attendance-pagination" current={targetQuery.data.page} pageSize={targetQuery.data.pageSize} total={targetQuery.data.total} showSizeChanger={false} onChange={setTargetPage} />}
        </>}
      </>}
      {items.length > 0 && <>
        <Divider orientation="left">Nội dung áp dụng ({items.length} người)</Divider>
        <Text type="secondary">Thời điểm nhập theo giờ Việt Nam và được gửi với múi giờ +07:00. Điều chỉnh thay thế toàn bộ các khoảng hiện diện; để trống danh sách khoảng giờ nếu xác nhận không có hiện diện.</Text>
        <div className="correction-item-list">
          {items.map(item => {
            const key = targetKey(item.target);
            return <div className="correction-item" key={key}>
              <div className="correction-item-heading">
                <span><strong>{item.target.employee.code} · {item.target.employee.fullName}</strong><small>{item.target.orgUnitCode} · {item.target.workDate}</small></span>
                <Button type="link" danger onClick={() => setItems(previous => previous.filter(current => targetKey(current.target) !== key))}>Bỏ chọn</Button>
              </div>
              {kind === "CORRECTION" && <div className="correction-intervals">
                {item.intervals.map((interval, index) => <div className="correction-interval-row" key={`${key}-${index}`}>
                  <Input type="datetime-local" value={interval.startAt} onChange={event => updateItem(key, current => ({ ...current, intervals: current.intervals.map((value, position) => position === index ? { ...value, startAt: event.target.value } : value) }))} aria-label={`Bắt đầu khoảng ${index + 1} của ${item.target.employee.fullName}`} />
                  <Input type="datetime-local" value={interval.endAt} onChange={event => updateItem(key, current => ({ ...current, intervals: current.intervals.map((value, position) => position === index ? { ...value, endAt: event.target.value } : value) }))} aria-label={`Kết thúc khoảng ${index + 1} của ${item.target.employee.fullName}`} />
                  <Button onClick={() => updateItem(key, current => ({ ...current, intervals: current.intervals.filter((_, position) => position !== index) }))} aria-label={`Xóa khoảng ${index + 1}`}>Xóa</Button>
                </div>)}
                <Button disabled={item.intervals.length >= 8} onClick={() => updateItem(key, current => ({ ...current, intervals: [...current.intervals, { startAt: "", endAt: "" }] }))}>Thêm khoảng giờ</Button>
              </div>}
              {kind === "EXPLANATION" && <Checkbox checked={item.excuseLateEarly} onChange={event => updateItem(key, current => ({ ...current, excuseLateEarly: event.target.checked }))}>Xin miễn đi muộn/về sớm theo quy định</Checkbox>}
            </div>;
          })}
        </div>
      </>}
      <div className="correction-editor-actions">
        <Button onClick={onClose}>Hủy</Button>
        <Button onClick={() => form.submit()} loading={save.isPending}>Lưu nháp</Button>
        <Button type="primary" icon={<SendOutlined />} loading={save.isPending} onClick={() => form.validateFields().then(values => save.mutate({ values, submit: true })).catch(() => undefined)}>Lưu và gửi duyệt</Button>
      </div>
    </Form>
  </Modal>;
}

function CorrectionDetail({
  correction,
  user,
  onClose,
  onEdit,
  onChanged,
}: {
  correction: Correction;
  user: AuthUser;
  onClose: () => void;
  onEdit: (correction: Correction) => void;
  onChanged: (correction: Correction) => void;
}) {
  const screens = Grid.useBreakpoint();
  const [reviewAction, setReviewAction] = useState<"return" | "reject">();
  const [reviewForm] = Form.useForm<{ reason: string }>();
  const canEdit = user.permissions.includes("attendance.explain") && correction.createdBy.id === user.id && (correction.status === "DRAFT" || correction.status === "RETURNED");
  const canReview = user.permissions.includes("attendance.review") && correction.status === "PENDING" && correction.createdBy.id !== user.id;
  const change = useMutation({
    mutationFn: ({ action, reason }: { action: "approve" | "return" | "reject"; reason?: string }) => correctionsApi.review(correction.id, action, correction.revision, reason),
    onSuccess: result => { onChanged(result.correction); setReviewAction(undefined); reviewForm.resetFields(); },
  });
  return <>
    <Drawer title="Chi tiết giải trình chấm công" open onClose={onClose} width={980} destroyOnHidden>
      {change.isError && <Alert type="error" showIcon message="Không cập nhật được trạng thái" description={errorMessage(change.error)} className="attendance-alert" />}
      <div className="correction-detail-heading">
        <div><Text type="secondary">{correction.kind === "CORRECTION" ? "Điều chỉnh giờ công" : "Giải trình"}</Text><h2>{correction.reason}</h2></div>
        {statusTag(correction.status)}
      </div>
      <Descriptions bordered size="small" column={screens.sm ? 2 : 1}>
        <Descriptions.Item label="Người lập">{correction.createdBy.displayName}</Descriptions.Item>
        <Descriptions.Item label="Lập lúc">{vietnamTime(correction.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Mã sự việc">{correction.incidentReference || "Không áp dụng"}</Descriptions.Item>
        <Descriptions.Item label="Tham chiếu bằng chứng">{correction.evidenceReference || "Chưa có"}</Descriptions.Item>
        <Descriptions.Item label="Gửi duyệt">{vietnamTime(correction.submittedAt)}</Descriptions.Item>
        <Descriptions.Item label="Quyết định">{correction.decidedBy ? `${correction.decidedBy.displayName} · ${vietnamTime(correction.decidedAt)}` : "Chưa quyết định"}</Descriptions.Item>
        {correction.decisionReason && <Descriptions.Item span={screens.sm ? 2 : 1} label="Lý do quyết định">{correction.decisionReason}</Descriptions.Item>}
      </Descriptions>
      {correction.warnings.length > 0 && <Alert type="warning" showIcon message="Lưu ý nghiệp vụ" description={<ul className="correction-warning-list">{correction.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>} className="attendance-alert" />}
      <Divider orientation="left">Dữ liệu trước và sau</Divider>
      <div className="correction-detail-items">
        {correction.items.map(item => <div className="correction-detail-item" key={item.id}>
          <Text strong>{item.employee.code} · {item.employee.fullName} · {item.orgUnitCode} · {item.workDate}</Text>
          <p>{item.intervals === null ? "Chỉ giải trình, giữ nguyên lượt quẹt gốc." : item.intervals.length ? item.intervals.map(interval => `${vietnamTime(interval.startAt)} – ${vietnamTime(interval.endAt)}`).join("; ") : "Xác nhận không có khoảng hiện diện."}</p>
          {item.excuseLateEarly && <Tag color="gold">Có đề nghị miễn đi muộn/về sớm</Tag>}
          <div className="correction-snapshots"><SnapshotView title="Trước" value={item.before} /><SnapshotView title="Sau" value={item.after} /></div>
        </div>)}
      </div>
      <Divider orientation="left">Bằng chứng</Divider>
      {correction.evidence.length ? <Table rowKey="id" components={{ body: { wrapper: TableBody } }} size="small" pagination={false} scroll={{ x: 700 }} dataSource={correction.evidence} columns={[
        { title: "Tệp", dataIndex: "fileName", width: 240 },
        { title: "Loại", dataIndex: "contentType", width: 150 },
        { title: "Dung lượng", dataIndex: "size", width: 120, align: "right", render: value => `${Number(value).toLocaleString("vi-VN")} B` },
        { title: "Tải lên", dataIndex: "createdAt", width: 180, render: vietnamTime },
        { title: "Tải", key: "download", width: 90, render: (_, evidence) => <Button type="link" icon={<DownloadOutlined />} href={correctionsApi.evidenceHref(correction.id, evidence.id)}>Tải</Button> },
      ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có tệp bằng chứng." />}
      <Divider orientation="left">Lịch sử xử lý</Divider>
      <Table rowKey="id" components={{ body: { wrapper: TableBody } }} size="small" pagination={false} scroll={{ x: 800 }} dataSource={correction.history} columns={[
        { title: "Thời điểm", dataIndex: "occurredAt", width: 180, render: vietnamTime },
        { title: "Thao tác", dataIndex: "action", width: 140, render: value => HISTORY_LABEL[value] ?? value },
        { title: "Người thực hiện", key: "actor", width: 180, render: (_, history) => history.actor.displayName },
        { title: "Lý do", dataIndex: "reason", render: value => value || "—" },
      ]} locale={{ emptyText: "Chưa có lịch sử." }} />
      <Divider />
      <Space wrap>
        {canEdit && <Button icon={<EditOutlined />} onClick={() => onEdit(correction)}>Sửa yêu cầu</Button>}
        {canReview && <Button type="primary" loading={change.isPending} onClick={() => change.mutate({ action: "approve" })}>Duyệt</Button>}
        {canReview && <Button loading={change.isPending} onClick={() => setReviewAction("return")}>Trả lại</Button>}
        {canReview && <Button danger loading={change.isPending} onClick={() => setReviewAction("reject")}>Từ chối</Button>}
      </Space>
    </Drawer>
    <Modal title={reviewAction === "return" ? "Trả lại giải trình" : "Từ chối giải trình"} open={Boolean(reviewAction)} onCancel={() => setReviewAction(undefined)} onOk={() => reviewForm.submit()} okText={reviewAction === "return" ? "Trả lại" : "Từ chối"} okButtonProps={{ danger: reviewAction === "reject", loading: change.isPending }} destroyOnHidden>
      <Form form={reviewForm} layout="vertical" onFinish={values => reviewAction && change.mutate({ action: reviewAction, reason: values.reason.trim() })}>
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: "Nhập lý do xử lý." }]}><Input.TextArea rows={4} maxLength={2000} /></Form.Item>
      </Form>
    </Modal>
  </>;
}

export function AttendanceCorrectionsPanel({
  user,
  periodId,
  orgUnitId,
  search,
  focusCorrectionId,
  onFocusHandled,
}: {
  user: AuthUser;
  periodId: string;
  orgUnitId?: string;
  search?: string;
  focusCorrectionId?: string | null;
  onFocusHandled?: () => void;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState<CorrectionStatus>();
  const [localSearch, setLocalSearch] = useState(search ?? "");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Correction | null | undefined>();
  const [selected, setSelected] = useState<Correction>();
  const canExplain = user.permissions.includes("attendance.explain");
  const corrections = useQuery({
    queryKey: ["attendance-corrections", periodId, orgUnitId, localSearch, status, page],
    queryFn: () => correctionsApi.list({ periodId, orgUnitId, search: localSearch || undefined, status, page, pageSize: PAGE_SIZE }),
  });

  useEffect(() => {
    if (!focusCorrectionId) return;
    setLocalSearch(focusCorrectionId);
    setStatus(undefined);
    setPage(1);
  }, [focusCorrectionId]);
  useEffect(() => {
    setPage(1);
  }, [periodId, orgUnitId, localSearch, status]);
  useEffect(() => {
    if (!focusCorrectionId || !corrections.data) return;
    const found = corrections.data.items.find(correction => correction.id === focusCorrectionId);
    if (!found) return;
    setSelected(found);
    onFocusHandled?.();
  }, [corrections.data, focusCorrectionId, onFocusHandled]);

  const updateLocal = (correction: Correction) => {
    setSelected(correction);
    void client.invalidateQueries({ queryKey: ["attendance-corrections"] });
    void client.invalidateQueries({ queryKey: ["attendance-board"] });
    void client.invalidateQueries({ queryKey: ["attendance-day"] });
    void client.invalidateQueries({ queryKey: ["attendance-overtime-actuals"] });
    void client.invalidateQueries({ queryKey: ["attendance-overtime-actual"] });
  };
  const columns = useMemo<ColumnsType<Correction>>(() => [
    { title: "Trạng thái", dataIndex: "status", width: 120, render: statusTag },
    { title: "Loại", dataIndex: "kind", width: 150, render: kind => kind === "CORRECTION" ? "Điều chỉnh giờ công" : "Giải trình" },
    { title: "Lý do", dataIndex: "reason", width: 290, ellipsis: true },
    { title: "Người lập", key: "creator", width: 170, render: (_, correction) => correction.createdBy.displayName },
    { title: "Ngày công", key: "dates", width: 160, render: (_, correction) => correction.items.map(item => item.workDate).filter((value, index, all) => all.indexOf(value) === index).join(", ") },
    { title: "Số người", key: "count", width: 100, align: "right", render: (_, correction) => correction.items.length.toLocaleString("vi-VN") },
    { title: "Cập nhật", dataIndex: "createdAt", width: 165, render: vietnamTime },
    { title: "Xem", key: "detail", fixed: "right", width: 80, render: (_, correction) => <Button type="link" onClick={event => { event.stopPropagation(); setSelected(correction); }}>Chi tiết</Button> },
  ], []);

  return <section aria-label="Giải trình chấm công" className="attendance-corrections">
    <div className="correction-toolbar">
      <Input.Search aria-label="Tìm giải trình" placeholder="Mã nhân viên, người lập hoặc lý do" value={localSearch} onChange={event => setLocalSearch(event.target.value)} onSearch={value => setLocalSearch(value)} />
      <Radio.Group aria-label="Lọc trạng thái giải trình" value={status ?? "all"} onChange={event => setStatus(event.target.value === "all" ? undefined : event.target.value)} options={[{ label: "Tất cả", value: "all" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} optionType="button" buttonStyle="solid" />
      {canExplain && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor(null)}>Lập giải trình</Button>}
    </div>
    {corrections.isError && <Alert type="error" showIcon message="Không tải được danh sách giải trình" description={errorMessage(corrections.error)} />}
    {corrections.isLoading ? <div className="attendance-workspace"><Spin /></div> : !corrections.isError && !corrections.data?.items.length ? <Empty description="Không có giải trình phù hợp." /> : <>
      <div className="table-panel attendance-table">
        <Table<Correction> rowKey="id" components={{ body: { wrapper: TableBody } }} columns={columns} dataSource={corrections.data?.items ?? []} loading={corrections.isFetching} pagination={false} scroll={{ x: 1280 }} onRow={correction => ({ className: "clickable-row", onClick: () => setSelected(correction) })} />
      </div>
      {corrections.data && <Pagination className="attendance-pagination" current={corrections.data.page} pageSize={corrections.data.pageSize} total={corrections.data.total} showSizeChanger={false} onChange={setPage} />}
    </>}
    {editor !== undefined && <CorrectionEditor correction={editor} periodId={periodId} orgUnitId={orgUnitId} onClose={() => setEditor(undefined)} onSaved={updateLocal} />}
    {selected && <CorrectionDetail correction={selected} user={user} onClose={() => setSelected(undefined)} onEdit={value => { setSelected(undefined); setEditor(value); }} onChanged={updateLocal} />}
  </section>;
}
