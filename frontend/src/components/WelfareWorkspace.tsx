import { DownloadOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { employeeApi, organizationApi } from "../api/hrtp";
import type { AuthUser } from "../api/hrtp";
import { payrollInputsApi } from "../api/payroll-inputs";
import { welfareApi } from "../api/welfare";
import type { BenefitBatchDetail, BenefitBatchSummary, BenefitCatalogItem, WelfareCostRow } from "../api/welfare";

const { Title, Text } = Typography;
const vnd = (value: string | null | undefined) => value == null ? "—" : Number(value).toLocaleString("vi-VN") + " đ";
const TAX: Record<string, string> = { TAXABLE: "Chịu thuế", NON_TAXABLE: "Không chịu thuế", EXEMPT_UP_TO_LIMIT: "Miễn đến định mức" };
const BATCH: Record<BenefitBatchSummary["status"], [string, string]> = { DRAFT: ["Dự kiến", "gold"], CONFIRMED: ["Đã xác nhận", "success"], CANCELLED: ["Đã hủy", "default"] };
const RULES: Record<string, string> = { EMPLOYED: "Không làm việc tại ngày tham chiếu", minServiceMonths: "Chưa đủ thâm niên", jobGradeCodes: "Cấp bậc không thuộc diện", contractTypes: "Loại hợp đồng không thuộc diện", orgUnitIds: "Đơn vị không thuộc diện" };
const CATEGORIES = [["HEALTH_INSURANCE", "Bảo hiểm sức khỏe"], ["HEALTH_CHECK", "Khám sức khỏe"], ["MEAL", "Ăn ca"], ["SHUTTLE", "Xe đưa đón"], ["PHONE", "Điện thoại"], ["UNIFORM", "Đồng phục"], ["GIFT", "Quà lễ Tết/sinh nhật"], ["FAMILY_EVENT", "Hiếu hỉ"], ["TRAVEL", "Du lịch"], ["TRAINING", "Đào tạo"], ["HOUSING", "Hỗ trợ nhà ở"], ["CHILDCARE", "Nuôi con nhỏ"]];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

function eligibilityText(value: Record<string, unknown>) {
  const parts = [];
  if (value.minServiceMonths !== undefined) parts.push("thâm niên ≥ " + value.minServiceMonths + " tháng");
  if (Array.isArray(value.contractTypes)) parts.push("HĐ " + value.contractTypes.join("/"));
  if (Array.isArray(value.jobGradeCodes)) parts.push("cấp bậc " + value.jobGradeCodes.join(", "));
  if (Array.isArray(value.orgUnitIds)) parts.push(value.orgUnitIds.length + " đơn vị");
  return parts.length ? parts.join("; ") : "Tất cả nhân viên đang làm việc";
}

function CatalogTab({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const catalog = useQuery({ queryKey: ["welfare-catalog"], queryFn: () => welfareApi.catalog() });
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context, enabled: open });
  const create = useMutation({ mutationFn: welfareApi.createCatalog, onSuccess: () => { setOpen(false); form.resetFields(); void client.invalidateQueries({ queryKey: ["welfare-catalog"] }); } });
  const treatment = Form.useWatch(["version", "taxTreatment"], form);
  return <div className="tab-stack">
    {canManage && <div><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Thêm phúc lợi</Button></div>}
    {catalog.isError ? <Alert type="error" showIcon message="Không tải được danh mục" description={errorMessage(catalog.error)} /> :
      <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh mục phúc lợi; dùng phím mũi tên để cuộn"><Table<BenefitCatalogItem>     rowKey="id" size="small" loading={catalog.isLoading} dataSource={catalog.data?.items ?? []} pagination={false} scroll={{ x: 1000 }}
        columns={[
          { title: "Phúc lợi", width: 240, render: (_, row) => <>{row.current?.name ?? row.code}<small className="table-subtext">{row.code} · {row.orgUnitCode}</small></> },
          { title: "Loại", dataIndex: "categoryLabel", width: 170 },
          { title: "Mức hưởng", width: 130, align: "right", render: (_, row) => vnd(row.current?.amount) },
          { title: "Thuế", width: 170, render: (_, row) => row.current ? TAX[row.current.taxTreatment] + (row.current.exemptLimit ? " (" + vnd(row.current.exemptLimit) + ")" : "") : "—" },
          { title: "Vào lương", width: 100, render: (_, row) => row.current?.payrollIncluded ? <Tag color="blue">Có</Tag> : "Không" },
          { title: "Điều kiện hưởng", render: (_, row) => row.current ? eligibilityText(row.current.eligibility) : "—" },
          { title: "Hiệu lực", width: 200, render: (_, row) => row.current ? row.current.effectiveFrom + " → " + (row.current.effectiveTo ?? "…") : <Text type="secondary">Không có bản hiệu lực</Text> },
        ]} /></section>}
    <Modal title="Thêm phúc lợi" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden width={640}>
      <Form form={form} layout="vertical" requiredMark="optional" initialValues={{ version: { taxTreatment: "TAXABLE", payrollIncluded: false, status: "SIMULATION", effectiveFrom: today() } }}
        onFinish={values => create.mutate({ ...values, version: { ...values.version, eligibility: values.version.minServiceMonths ? { minServiceMonths: Number(values.version.minServiceMonths) } : {}, minServiceMonths: undefined } })}>
        <div className="form-grid">
          <Form.Item name="code" label="Mã" rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/, message: "Mã gồm chữ, số, gạch." }]}><Input /></Form.Item>
          <Form.Item name="category" label="Loại" rules={[{ required: true }]}><Select options={CATEGORIES.map(([value, label]) => ({ value, label }))} /></Form.Item>
        </div>
        <Form.Item name="orgUnitId" label="Áp dụng cho" rules={[{ required: true }]}><Select loading={context.isLoading} options={(context.data?.units ?? []).filter(unit => unit.type === "COMPANY" || unit.type === "SITE").map(unit => ({ value: unit.id, label: unit.pathLabel }))} /></Form.Item>
        <div className="form-grid">
          <Form.Item name={["version", "name"]} label="Tên" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
          <Form.Item name={["version", "amount"]} label="Mức hưởng (đồng)" rules={[{ required: true, pattern: /^\d+$/, message: "Số tiền nguyên." }]}><Input inputMode="numeric" /></Form.Item>
          <Form.Item name={["version", "taxTreatment"]} label="Xử lý thuế"><Select options={Object.entries(TAX).map(([value, label]) => ({ value, label }))} /></Form.Item>
          {treatment === "EXEMPT_UP_TO_LIMIT" && <Form.Item name={["version", "exemptLimit"]} label="Định mức miễn (đồng)" rules={[{ required: true, pattern: /^\d+$/ }]}><Input inputMode="numeric" /></Form.Item>}
          <Form.Item name={["version", "minServiceMonths"]} label="Thâm niên tối thiểu (tháng)"><Input inputMode="numeric" /></Form.Item>
          <Form.Item name={["version", "effectiveFrom"]} label="Hiệu lực từ" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name={["version", "payrollIncluded"]} label="Đưa vào bảng lương" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name={["version", "status"]} label="Trạng thái"><Select options={[{ value: "SIMULATION", label: "Mô phỏng" }, { value: "BUSINESS_CONFIRMED", label: "Đã xác nhận nghiệp vụ" }]} /></Form.Item>
        </div>
        <Form.Item name={["version", "decisionReference"]} label="Quyết định / quy chế" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        {create.isError && <Alert type="error" showIcon message="Không lưu được" description={errorMessage(create.error)} />}
        <Space className="modal-actions"><Button onClick={() => setOpen(false)}>Hủy</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Lưu</Button></Space>
      </Form>
    </Modal>
  </div>;
}

function BatchDrawer({ id, onClose, canManage }: { id: string | null; onClose: () => void; canManage: boolean }) {
  const client = useQueryClient();
  const [adding, setAdding] = useState<{ employeeId?: string; reason: string } | null>(null);
  const [search, setSearch] = useState("");
  const detail = useQuery({ queryKey: ["welfare-batch", id], queryFn: () => welfareApi.batch(id!), enabled: Boolean(id) });
  const employees = useQuery({ queryKey: ["employees", "welfare", search], queryFn: () => employeeApi.list({ page: 1, pageSize: 20, search }), enabled: adding !== null });
  const set = (data: BenefitBatchDetail) => { client.setQueryData(["welfare-batch", id], data); void client.invalidateQueries({ queryKey: ["welfare-batches"] }); };
  const add = useMutation({ mutationFn: () => welfareApi.addCandidate(id!, detail.data!.batch.revision, adding!.employeeId!, adding!.reason.trim() || undefined), onSuccess: data => { setAdding(null); set(data); } });
  const remove = useMutation({ mutationFn: (employeeId: string) => welfareApi.removeCandidate(id!, detail.data!.batch.revision, employeeId), onSuccess: set });
  const confirm = useMutation({ mutationFn: () => welfareApi.confirm(id!, detail.data!.batch.revision), onSuccess: set });
  const data = detail.data;
  const draft = data?.batch.status === "DRAFT" && canManage;
  const error = detail.error ?? add.error ?? remove.error ?? confirm.error;
  return <Drawer width={820} open={Boolean(id)} onClose={onClose} title={data ? "Lô " + data.batch.code : "Lô cấp phát"} destroyOnHidden>
    {data && <div className="tab-stack">
      <Space wrap><Tag color={BATCH[data.batch.status][1]}>{BATCH[data.batch.status][0]}</Tag><Text>{data.batch.version.name} · kỳ {data.batch.periodCode} · tham chiếu {data.batch.referenceDate} · {vnd(data.batch.version.amount)}/người</Text>{data.batch.payrollPeriodCode && <Tag>Kỳ lương {data.batch.payrollPeriodCode}</Tag>}</Space>
      {data.batch.status === "DRAFT" && <Alert type="info" showIcon message="Danh sách dự kiến chưa ảnh hưởng bảng lương hay chi phí cho đến khi xác nhận. Mỗi lần thêm/bớt hệ thống kiểm tra lại điều kiện." />}
      {data.batch.result && data.batch.result.duplicates.length > 0 && <Alert type="warning" showIcon message={data.batch.result.duplicates.length + " người đã được cấp phúc lợi này trong cùng kỳ — không ghi nhận lần hai, cần kiểm tra lại"}
        description={data.batch.result.duplicates.map(row => row.code + " " + row.fullName + " (lô " + row.existingBatch + ")").join("; ")} />}
      {error && <Alert type="error" showIcon message="Không thực hiện được" description={errorMessage(error)} />}
      {draft && <Space wrap><Button icon={<PlusOutlined />} onClick={() => setAdding({ reason: "" })}>Thêm người</Button><Button type="primary" loading={confirm.isPending} disabled={!data.candidates.length} onClick={() => confirm.mutate()}>Xác nhận cấp phát</Button></Space>}
      <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh sách cấp phát phúc lợi; dùng phím mũi tên để cuộn"><Table     rowKey={row => row.employee.id} size="small" pagination={false} scroll={{ x: 700 }}
        dataSource={data.batch.status === "DRAFT" ? data.candidates : data.allocations.map(row => ({ employee: row.employee, eligible: true, failedRules: [], manual: false, manualReason: null, amount: row.amount }))}
        locale={{ emptyText: <Empty description="Không có ai trong danh sách" /> }}
        columns={[
          { title: "Nhân sự", render: (_, row) => <>{row.employee.fullName}<small className="table-subtext">{row.employee.code}</small></> },
          { title: "Điều kiện", render: (_, row) => row.eligible ? <Tag color="success">Đủ điều kiện</Tag> : <><Tag color="orange">Giữ thủ công</Tag><small className="table-subtext">{row.failedRules.map(item => RULES[item.rule] ?? item.rule).join("; ")} — {row.manualReason}</small></> },
          ...(draft ? [{ title: "", width: 90, render: (_: unknown, row: BenefitBatchDetail["candidates"][number]) => <Button size="small" danger loading={remove.isPending} onClick={() => remove.mutate(row.employee.id)}>Bớt</Button> }] : []),
        ]} /></section>
    </div>}
    <Modal title="Thêm người vào danh sách dự kiến" open={adding !== null} onCancel={() => setAdding(null)} okText="Thêm" okButtonProps={{ disabled: !adding?.employeeId, loading: add.isPending }} onOk={() => add.mutate()}>
      <Space direction="vertical" className="full-width">
        <Select showSearch filterOption={false} onSearch={setSearch} className="full-width" placeholder="Tìm nhân sự" value={adding?.employeeId} onChange={value => setAdding(current => ({ reason: current?.reason ?? "", employeeId: value }))}
          options={employees.data?.items.map(item => ({ value: item.id, label: item.code + " — " + item.fullName }))} />
        <Input.TextArea rows={2} placeholder="Lý do (bắt buộc nếu người này chưa đủ điều kiện)" value={adding?.reason} onChange={event => setAdding(current => ({ ...current, reason: event.target.value }))} />
        {add.isError && <Alert type="warning" showIcon message={errorMessage(add.error)} />}
      </Space>
    </Modal>
  </Drawer>;
}

function BatchesTab({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form] = Form.useForm();
  const batches = useQuery({ queryKey: ["welfare-batches"], queryFn: welfareApi.batches });
  const catalog = useQuery({ queryKey: ["welfare-catalog"], queryFn: () => welfareApi.catalog(), enabled: open });
  const context = useQuery({ queryKey: ["organization-context"], queryFn: organizationApi.context, enabled: open });
  const periods = useQuery({ queryKey: ["payroll-input-periods"], queryFn: payrollInputsApi.periods, enabled: open });
  const create = useMutation({ mutationFn: welfareApi.createBatch, onSuccess: data => { setOpen(false); form.resetFields(); setSelected(data.batch.id); void client.invalidateQueries({ queryKey: ["welfare-batches"] }); } });
  const catalogId = Form.useWatch("catalogId", form);
  const chosen = catalog.data?.items.find(item => item.id === catalogId);
  return <div className="tab-stack">
    {canManage && <div><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Lập danh sách cấp phát</Button></div>}
    {batches.isError ? <Alert type="error" showIcon message="Không tải được lô cấp phát" description={errorMessage(batches.error)} /> :
      <section className="workspace-table" role="region" tabIndex={0} aria-label="Danh sách lô cấp phát phúc lợi; dùng phím mũi tên để cuộn"><Table<BenefitBatchSummary>     rowKey="id" size="small" loading={batches.isLoading} dataSource={batches.data?.items ?? []} pagination={false} scroll={{ x: 900 }}
        onRow={row => ({ onClick: () => setSelected(row.id), className: "clickable-row" })} locale={{ emptyText: <Empty description="Chưa có lô cấp phát" /> }}
        columns={[
          { title: "Lô", dataIndex: "code", width: 260 }, { title: "Phúc lợi", dataIndex: "name" }, { title: "Kỳ", dataIndex: "periodCode", width: 110 }, { title: "Đối tượng", dataIndex: "scopeCode", width: 140 },
          { title: "Số người", width: 110, align: "right", render: (_, row) => row.status === "CONFIRMED" ? row.allocations : row.candidates },
          { title: "Trạng thái", width: 140, render: (_, row) => <Tag color={BATCH[row.status][1]}>{BATCH[row.status][0]}</Tag> },
        ]} /></section>}
    <Modal title="Lập danh sách cấp phát dự kiến" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark="optional" initialValues={{ referenceDate: today() }} onFinish={values => create.mutate({ ...values, periodCode: values.periodCode.trim().toUpperCase() })}>
        <Form.Item name="catalogId" label="Phúc lợi" rules={[{ required: true }]}><Select loading={catalog.isLoading} options={catalog.data?.items.filter(item => item.current?.active).map(item => ({ value: item.id, label: item.current!.name + " (" + item.code + ")" }))} /></Form.Item>
        <div className="form-grid">
          <Form.Item name="periodCode" label="Mã kỳ phúc lợi" rules={[{ required: true, message: "Ví dụ 2026-10 hoặc TET-2027." }]}><Input placeholder="2026-10" /></Form.Item>
          <Form.Item name="referenceDate" label="Ngày tham chiếu điều kiện" rules={[{ required: true }]}><Input type="date" /></Form.Item>
        </div>
        <Form.Item name="scopeOrgUnitId" label="Đối tượng (đơn vị)" rules={[{ required: true }]}><Select loading={context.isLoading} showSearch optionFilterProp="label" options={context.data?.units.map(unit => ({ value: unit.id, label: unit.pathLabel }))} /></Form.Item>
        {chosen?.current?.payrollIncluded && <Form.Item name="payrollPeriodId" label="Kỳ lương nhận khoản" rules={[{ required: true }]}><Select loading={periods.isLoading} options={periods.data?.items.filter(item => item.status === "OPEN").map(item => ({ value: item.id, label: item.code }))} /></Form.Item>}
        {create.isError && <Alert type="error" showIcon message="Không lập được danh sách" description={errorMessage(create.error)} />}
        <Space className="modal-actions"><Button onClick={() => setOpen(false)}>Hủy</Button><Button type="primary" htmlType="submit" loading={create.isPending}>Lọc danh sách</Button></Space>
      </Form>
    </Modal>
    <BatchDrawer id={selected} onClose={() => setSelected(null)} canManage={canManage} />
  </div>;
}

function CostsTab() {
  const month = today().slice(0, 7);
  const [range, setRange] = useState({ from: month, to: month });
  const costs = useQuery({ queryKey: ["welfare-costs", range], queryFn: () => welfareApi.costs(range.from, range.to) });
  const exporter = useMutation({ mutationFn: () => welfareApi.exportCosts(range.from, range.to), onSuccess: blob => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "chi-phi-phuc-loi.xlsx"; link.click(); URL.revokeObjectURL(link.href); } });
  return <div className="tab-stack">
    <Space wrap><label>Từ tháng <Input type="month" value={range.from} onChange={event => event.target.value && setRange(current => ({ ...current, from: event.target.value }))} /></label>
      <label>Đến tháng <Input type="month" value={range.to} onChange={event => event.target.value && setRange(current => ({ ...current, to: event.target.value }))} /></label>
      <Button icon={<DownloadOutlined />} loading={exporter.isPending} onClick={() => exporter.mutate()}>Xuất Excel</Button></Space>
    {(costs.error ?? exporter.error) && <Alert type="error" showIcon message="Không tải được chi phí" description={errorMessage(costs.error ?? exporter.error)} />}
    <section className="workspace-table" role="region" tabIndex={0} aria-label="Chi phí phúc lợi; dùng phím mũi tên để cuộn"><Table<WelfareCostRow>     rowKey={row => row.month + row.costCenterCode + row.category} size="small" loading={costs.isLoading} dataSource={costs.data?.items ?? []} pagination={false} scroll={{ x: 720 }}
      locale={{ emptyText: <Empty description="Chưa có chi phí phúc lợi đã xác nhận" /> }}
      summary={() => costs.data?.items.length ? <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4}><b>Tổng</b></Table.Summary.Cell><Table.Summary.Cell index={4} align="right"><b>{vnd(costs.data.total)}</b></Table.Summary.Cell></Table.Summary.Row> : null}
      columns={[
        { title: "Tháng", dataIndex: "month", width: 110 }, { title: "Cost center", dataIndex: "costCenterCode", width: 150, render: value => value ?? "—" },
        { title: "Loại", dataIndex: "categoryLabel" }, { title: "Số lượt", dataIndex: "count", width: 100, align: "right" }, { title: "Số tiền", dataIndex: "amount", width: 160, align: "right", render: vnd },
      ]} /></section>
  </div>;
}

export function WelfareWorkspace({ user }: { user: AuthUser }) {
  const canManage = user.permissions.includes("welfare.manage");
  return <div className="content-stack">
    <div className="page-heading"><div><p className="eyebrow">PHÚC LỢI</p><Title level={1}>Phúc lợi</Title></div></div>
    <section className="panel settings-panel"><Tabs items={[
      { key: "catalog", label: "Danh mục", children: <CatalogTab canManage={canManage} /> },
      { key: "batches", label: "Cấp phát", children: <BatchesTab canManage={canManage} /> },
      { key: "costs", label: "Chi phí phúc lợi", children: <CostsTab /> },
    ]} /></section>
  </div>;
}
