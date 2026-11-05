import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Select, Table, Tabs, Tag, Typography } from "antd";
import { useState } from "react";
import type { AuthUser } from "../api/hrtp";
import { errorMessage } from "../api/client";
import { salaryDecisionApi } from "../api/salary-decisions";
import type { RetroCandidate } from "../api/salary-decisions";
import { InsuranceRatesPanel } from "./InsuranceRatesPanel";
import { C12ReconciliationPanel, InsuranceChangesPanel } from "./InsuranceChangesPanel";
import { PitRulesetsPanel } from "./PitRulesetsPanel";
import { TaxFinalizationPanel } from "./TaxFinalizationPanel";
import { PayrollSheetPanel } from "./PayrollSheetPanel";
import { BankTemplatesPanel, PaymentBatchesPanel, PayslipsPanel } from "./PayrollOutputPanels";
import { BonusPlansPanel, RetroAdjustmentsPanel } from "./PayrollAdjustmentPanels";
import { BusinessIllustration } from "./BusinessIllustration";

const { Title, Paragraph } = Typography;
const RETRO_STATUS: Record<RetroCandidate["status"], [string, string]> = { PENDING: ["Chờ xử lý", "orange"], RESOLVED: ["Đã truy lĩnh/truy thu", "success"], DISMISSED: ["Bỏ qua có lý do", "default"] };

function RetroCandidatesPanel({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<string | undefined>("PENDING");
  const [dismissing, setDismissing] = useState<RetroCandidate | null>(null);
  const [note, setNote] = useState("");
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["retro-candidates", status], queryFn: () => salaryDecisionApi.retroCandidates(status) });
  const dismiss = useMutation({ mutationFn: () => salaryDecisionApi.dismiss(dismissing!.id, note), onSuccess: () => { setDismissing(null); setNote(""); void client.invalidateQueries({ queryKey: ["retro-candidates"] }); } });
  return <section aria-label="Ứng viên hồi tố" className="tab-stack">
    <Paragraph type="secondary">Quyết định lương có ngày hiệu lực rơi vào kỳ lương đã khóa. Kỳ đã khóa không bị sửa; chênh lệch được xử lý ở kỳ đang mở.</Paragraph>
    <div className="workspace-filters"><label>Trạng thái<Select allowClear value={status} onChange={setStatus} style={{ minWidth: 200 }} options={Object.entries(RETRO_STATUS).map(([value, [label]]) => ({ value, label }))} /></label></div>
    {list.isError && <Alert type="error" showIcon message="Không tải được ứng viên hồi tố" description={errorMessage(list.error)} />}
    <div className="table-panel" role="region" tabIndex={0} aria-label="Bảng ứng viên hồi tố; dùng phím mũi tên để cuộn">
      <Table<RetroCandidate> rowKey="id" loading={list.isLoading} dataSource={list.data?.items ?? []} scroll={{ x: 820 }} columns={[
        { title: "Nhân sự", render: (_, row) => `${row.employee.code} — ${row.employee.fullName}` },
        { title: "Quyết định", render: (_, row) => `${row.decision.decisionNumber} (hiệu lực ${row.decision.effectiveFrom})` },
        { title: "Kỳ lương khóa", render: (_, row) => `${row.payrollPeriod.code} (${row.payrollPeriod.dateFrom} → ${row.payrollPeriod.dateTo})` },
        { title: "Trạng thái", dataIndex: "status", render: (value: RetroCandidate["status"]) => <Tag color={RETRO_STATUS[value][1]}>{RETRO_STATUS[value][0]}</Tag> },
        ...(canManage ? [{ title: "", width: 110, render: (_: unknown, row: RetroCandidate) => row.status === "PENDING" && <Button size="small" onClick={() => setDismissing(row)}>Bỏ qua</Button> }] : []),
      ]} />
    </div>
    <Modal title="Bỏ qua ứng viên hồi tố" open={Boolean(dismissing)} onCancel={() => setDismissing(null)} okText="Xác nhận" okButtonProps={{ disabled: !note.trim(), loading: dismiss.isPending }} onOk={() => dismiss.mutate()}>
      <Input.TextArea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Lý do không cần truy lĩnh/truy thu" />
      {dismiss.isError && <Alert type="error" showIcon message={errorMessage(dismiss.error)} />}
    </Modal>
  </section>;
}

export function PayrollWorkspace({ user }: { user: AuthUser }) {
  const items = [
    ...(user.permissions.includes("payroll.read") ? [{ key: "sheet", label: "Bảng lương", children: <PayrollSheetPanel canCalculate={user.permissions.includes("payroll.calculate")} canApprove={user.permissions.includes("payroll.approve")} canLock={user.permissions.includes("payroll.lock")} /> }] : []),
    ...(user.permissions.includes("payroll.payslips") ? [{ key: "payslips", label: "Phiếu lương", children: <PayslipsPanel /> }] : []),
    ...(user.permissions.includes("payroll.payment") ? [{ key: "payments", label: "Chi lương", children: <PaymentBatchesPanel /> }, { key: "bank-templates", label: "Mẫu file ngân hàng", children: <BankTemplatesPanel /> }] : []),
    ...(user.permissions.includes("insurance.read") ? [{ key: "insurance", label: "Mức đóng BH", children: <InsuranceRatesPanel canManage={user.permissions.includes("insurance.manage")} /> },
      { key: "insurance-changes", label: "Biến động BH", children: <InsuranceChangesPanel canManage={user.permissions.includes("insurance.manage")} /> },
      { key: "c12", label: "Đối chiếu C12", children: <C12ReconciliationPanel canManage={user.permissions.includes("insurance.manage")} /> }] : []),
    ...(user.permissions.includes("tax.read") ? [{ key: "pit", label: "Quy tắc thuế TNCN", children: <PitRulesetsPanel /> }, { key: "pit-finalization", label: "Quyết toán TNCN", children: <TaxFinalizationPanel canManage={user.permissions.includes("tax.manage")} /> }] : []),
    ...(user.permissions.includes("payroll.bonus") ? [{ key: "bonuses", label: "Đợt thưởng", children: <BonusPlansPanel /> }] : []),
    ...(user.permissions.includes("payroll.adjust") ? [{ key: "retro", label: "Hồi tố & điều chỉnh", children: <RetroAdjustmentsPanel /> }]
      : user.permissions.includes("contract.read") ? [{ key: "retro", label: "Ứng viên hồi tố", children: <RetroCandidatesPanel canManage={user.permissions.includes("contract.manage")} /> }] : []),
  ];
  return <section className="workspace content-stack" aria-labelledby="payroll-title">
    <div className="page-heading page-heading-illustrated"><div><Title id="payroll-title" level={1}>Bảng lương</Title><Paragraph type="secondary">Tính, duyệt, khóa bảng lương; phát hành phiếu lương, chi lương và xử lý điều chỉnh theo kỳ.</Paragraph></div><BusinessIllustration kind="payroll" className="business-art-header" /></div>
    <section className="panel settings-panel"><Tabs items={items} /></section>
  </section>;
}
