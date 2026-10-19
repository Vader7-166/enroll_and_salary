import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, type FormInstance } from "antd";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../api/client";
import { authApi, type Account, type AccountAssignment, type AccountContext, type AccountExclusion, type AssignmentInput, type AuthUser, type ExclusionInput, type RoleCode } from "../api/hrtp";

const { Paragraph, Text, Title } = Typography;

function preserveRequiredCombobox(select: { nativeElement: HTMLElement } | null) {
  // rc-select duplicates aria-required on its generic wrapper; the input retains it.
  select?.nativeElement.removeAttribute("aria-required");
}

function canDisable(account: Account | null): boolean {
  return account?.status === "ACTIVE" && (!account.lockedUntil || Date.parse(account.lockedUntil) <= Date.now());
}

function vietnamToday(): string {
  const values = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const TODAY = vietnamToday();

type GrantValue = AssignmentInput & { id?: string };
type ExclusionValue = ExclusionInput & { id?: string };
type AccountFormValues = {
  username?: string;
  displayName: string;
  employeeId?: string | null;
  password?: string;
  assignments: GrantValue[];
  exclusions: ExclusionValue[];
  reason: string;
};

function isHistorical(item: { effectiveTo?: string | null }, asOf: string) {
  return Boolean(item.effectiveTo && item.effectiveTo < asOf);
}

function labelForRole(context: AccountContext | undefined, role: RoleCode) {
  const name = context?.roles.find((item) => item.code === role)?.name;
  return name ? `${role} — ${name}` : role;
}

function grantPayload(values: GrantValue[]): AssignmentInput[] {
  return values.map(({ roleCode, scopeOrgUnitId, effectiveFrom, effectiveTo }) => ({ roleCode, scopeOrgUnitId, effectiveFrom, effectiveTo: effectiveTo || null }));
}

function exclusionPayload(values: ExclusionValue[]): ExclusionInput[] {
  return values.map(({ employeeId, effectiveFrom, effectiveTo }) => ({ employeeId, effectiveFrom, effectiveTo: effectiveTo || null }));
}

function validateRanges(values: AccountFormValues, context: AccountContext | undefined): string | undefined {
  const grants = values.assignments ?? [];
  const exclusions = values.exclusions ?? [];
  if (!grants.length) return "Thêm ít nhất một phân quyền.";
  const normalized = (start: string, end?: string | null) => [start, end || "9999-12-31"] as const;
  const overlapping = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;
  for (const list of [grants, exclusions]) {
    for (const entry of list) if (!entry.effectiveFrom || (entry.effectiveTo && entry.effectiveTo < entry.effectiveFrom)) return "Khoảng hiệu lực không hợp lệ.";
  }
  for (let index = 0; index < grants.length; index += 1) for (let next = index + 1; next < grants.length; next += 1) {
    if (grants[index].roleCode === grants[next].roleCode && grants[index].scopeOrgUnitId === grants[next].scopeOrgUnitId) {
      const [aStart, aEnd] = normalized(grants[index].effectiveFrom, grants[index].effectiveTo);
      const [bStart, bEnd] = normalized(grants[next].effectiveFrom, grants[next].effectiveTo);
      if (overlapping(aStart, aEnd, bStart, bEnd)) return "Không được có phân quyền cùng vai trò và đơn vị bị chồng lấn.";
    }
  }
  for (let index = 0; index < exclusions.length; index += 1) for (let next = index + 1; next < exclusions.length; next += 1) {
    if (exclusions[index].employeeId === exclusions[next].employeeId) {
      const [aStart, aEnd] = normalized(exclusions[index].effectiveFrom, exclusions[index].effectiveTo);
      const [bStart, bEnd] = normalized(exclusions[next].effectiveFrom, exclusions[next].effectiveTo);
      if (overlapping(aStart, aEnd, bStart, bEnd)) return "Không được có thời gian loại trừ nhân sự bị chồng lấn.";
    }
  }
  if (context && grants.some((grant) => !context.units.some((unit) => unit.id === grant.scopeOrgUnitId))) return "Một đơn vị được chọn không còn thuộc phạm vi quản trị.";
  return undefined;
}

function FormError({ error }: { error: unknown }) {
  return error ? <Alert className="form-alert" type="error" showIcon message="Không thể lưu thay đổi" description={errorMessage(error)} /> : null;
}

function GrantFields({ context, form }: { context: AccountContext | undefined; form: FormInstance<AccountFormValues> }) {
  const asOf = context?.asOf ?? TODAY;
  return <Form.List name="assignments">{(fields, { add, remove }) => <section aria-labelledby="account-grants-heading">
    <div className="section-heading"><div><Text id="account-grants-heading" strong>Phân quyền theo phạm vi</Text><small className="table-subtext">Dòng đã hết hiệu lực chỉ được lưu giữ nguyên.</small></div><Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ effectiveFrom: asOf, effectiveTo: null })}>Thêm phân quyền</Button></div>
    {fields.map((field) => {
      const value = form.getFieldValue(["assignments", field.name]) as GrantValue | undefined;
      const readOnly = isHistorical(value ?? {}, asOf);
      return <div className="form-grid" key={field.key}>
        <Form.Item name={[field.name, "id"]} hidden><Input /></Form.Item>
        <Form.Item name={[field.name, "roleCode"]} label="Vai trò" rules={[{ required: true, message: "Chọn vai trò." }]}><Select ref={preserveRequiredCombobox} disabled={readOnly} options={context?.roles.map((role) => ({ value: role.code, label: `${role.code} — ${role.name}` }))} /></Form.Item>
        <Form.Item name={[field.name, "scopeOrgUnitId"]} label="Đơn vị / phạm vi" rules={[{ required: true, message: "Chọn đơn vị." }]}><Select ref={preserveRequiredCombobox} disabled={readOnly} showSearch optionFilterProp="label" options={context?.units.map((unit) => ({ value: unit.id, label: `${unit.pathLabel} (${unit.code})` }))} /></Form.Item>
        <Form.Item name={[field.name, "effectiveFrom"]} label="Từ ngày" rules={[{ required: true, message: "Chọn ngày hiệu lực." }]}><Input disabled={readOnly} type="date" /></Form.Item>
        <Form.Item name={[field.name, "effectiveTo"]} label="Đến ngày"><Input disabled={readOnly} type="date" /></Form.Item>
        <Form.Item label="Thao tác"><Button danger disabled={readOnly} icon={<DeleteOutlined />} onClick={() => remove(field.name)}>Xóa</Button></Form.Item>
      </div>;
    })}
  </section>}</Form.List>;
}

function ExclusionFields({ context, form }: { context: AccountContext | undefined; form: FormInstance<AccountFormValues> }) {
  const asOf = context?.asOf ?? TODAY;
  return <Form.List name="exclusions">{(fields, { add, remove }) => <section aria-labelledby="account-exclusions-heading">
    <div className="section-heading"><div><Text id="account-exclusions-heading" strong>Loại trừ nhân sự</Text><small className="table-subtext">Loại trừ giới hạn quyền xem/xử lý nhân sự cụ thể.</small></div><Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ effectiveFrom: asOf, effectiveTo: null })}>Thêm loại trừ</Button></div>
    {fields.map((field) => {
      const value = form.getFieldValue(["exclusions", field.name]) as ExclusionValue | undefined;
      const readOnly = isHistorical(value ?? {}, asOf);
      return <div className="form-grid" key={field.key}>
        <Form.Item name={[field.name, "id"]} hidden><Input /></Form.Item>
        <Form.Item className="form-span-2" name={[field.name, "employeeId"]} label="Nhân sự" rules={[{ required: true, message: "Chọn nhân sự." }]}><Select ref={preserveRequiredCombobox} disabled={readOnly} showSearch optionFilterProp="label" options={context?.employees.map((employee) => ({ value: employee.id, label: `${employee.code} — ${employee.fullName}` }))} /></Form.Item>
        <Form.Item name={[field.name, "effectiveFrom"]} label="Từ ngày" rules={[{ required: true, message: "Chọn ngày hiệu lực." }]}><Input disabled={readOnly} type="date" /></Form.Item>
        <Form.Item name={[field.name, "effectiveTo"]} label="Đến ngày"><Input disabled={readOnly} type="date" /></Form.Item>
        <Form.Item label="Thao tác"><Button danger disabled={readOnly} icon={<DeleteOutlined />} onClick={() => remove(field.name)}>Xóa</Button></Form.Item>
      </div>;
    })}
  </section>}</Form.List>;
}

function AccountEditor({ account, context, open, onClose }: { account: Account | null; context: AccountContext | undefined; open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const [form] = Form.useForm<AccountFormValues>();
  const mutation = useMutation({
    mutationFn: (values: AccountFormValues) => {
      const problem = validateRanges(values, context);
      if (problem) return Promise.reject(new Error(problem));
      const shared = { displayName: values.displayName.trim(), employeeId: values.employeeId || null, assignments: grantPayload(values.assignments ?? []), exclusions: exclusionPayload(values.exclusions ?? []), reason: values.reason.trim() };
      return account ? authApi.updateAccount(account.id, { revision: account.revision, ...shared }) : authApi.createAccount({ username: values.username!.trim(), password: values.password!, ...shared });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["accounts"] }); onClose(); },
  });
  useEffect(() => {
    if (!open) return;
    mutation.reset();
    form.setFieldsValue(account ? {
      username: account.username, displayName: account.displayName, employeeId: account.employeeId, reason: "",
      assignments: account.assignments.map((item: AccountAssignment) => ({ id: item.id, roleCode: item.roleCode, scopeOrgUnitId: item.scopeOrgUnitId, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo })),
      exclusions: account.exclusions.map((item: AccountExclusion) => ({ id: item.id, employeeId: item.employeeId, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo })),
    } : { username: "", displayName: "", employeeId: null, password: "", assignments: [{ effectiveFrom: context?.asOf ?? TODAY, effectiveTo: null }], exclusions: [], reason: "" });
  }, [account, context?.asOf, form, open]);
  return <Modal className="account-modal" title={account ? `Cập nhật ${account.username}` : "Tạo tài khoản"} open={open} onCancel={onClose} footer={null} width={900} destroyOnHidden>
    <Form form={form} layout="vertical" requiredMark="optional" onFinish={(values) => mutation.mutate(values)} disabled={mutation.isPending}>
      <FormError error={mutation.error} />
      <div className="form-grid">
        <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: !account, message: "Nhập tên đăng nhập." }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/, message: "Tên đăng nhập cần 3–64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang." }]}><Input disabled={Boolean(account)} autoComplete="username" /></Form.Item>
        <Form.Item name="displayName" label="Tên hiển thị" rules={[{ required: true, min: 2, max: 120, message: "Nhập tên hiển thị từ 2 đến 120 ký tự." }]}><Input /></Form.Item>
        <Form.Item name="employeeId" label="Liên kết nhân sự"><Select ref={preserveRequiredCombobox} allowClear showSearch optionFilterProp="label" options={context?.employees.map((employee) => ({ value: employee.id, label: `${employee.code} — ${employee.fullName}` }))} /></Form.Item>
        {!account && <Form.Item name="password" label="Mật khẩu tạm thời" rules={[{ required: true, message: "Nhập mật khẩu tạm thời." }, { min: context?.policy.minLength ?? 1, message: `Mật khẩu tối thiểu ${context?.policy.minLength ?? 1} ký tự.` }]}><Input.Password autoComplete="new-password" /></Form.Item>}
      </div>
      <GrantFields context={context} form={form} />
      <ExclusionFields context={context} form={form} />
      <Form.Item name="reason" label="Lý do thay đổi" rules={[{ required: true, whitespace: true, max: 500, message: "Nhập lý do thay đổi (tối đa 500 ký tự)." }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending} disabled={!context}>{account ? "Lưu thay đổi" : "Tạo tài khoản"}</Button></Space>
    </Form>
  </Modal>;
}

function AccountAction({ account, kind, open, onClose }: { account: Account | null; kind: "status" | "password" | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ reason: string; password?: string }>();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: { reason: string; password?: string }) => {
      if (!account || !kind) throw new Error("Không tìm thấy tài khoản.");
      return kind === "status" ? authApi.setAccountStatus(account.id, { revision: account.revision, status: canDisable(account) ? "DISABLED" : "ACTIVE", reason: values.reason.trim() }) : authApi.resetAccountPassword(account.id, { revision: account.revision, password: values.password!, reason: values.reason.trim() });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["accounts"] }); onClose(); },
  });
  useEffect(() => { if (open) { form.resetFields(); mutation.reset(); } }, [form, open]);
  const isStatus = kind === "status";
  return <Modal className="account-modal" title={isStatus ? (canDisable(account) ? "Vô hiệu hóa tài khoản" : "Mở khóa tài khoản") : "Đặt lại mật khẩu"} open={open} onCancel={onClose} footer={null} destroyOnHidden>
    <Form form={form} layout="vertical" requiredMark="optional" onFinish={(values) => mutation.mutate(values)} disabled={mutation.isPending}>
      <FormError error={mutation.error} />
      {isStatus ? <Paragraph>{canDisable(account) ? "Tài khoản sẽ không thể đăng nhập và mọi phiên hiện tại sẽ bị thu hồi." : "Tài khoản sẽ được mở lại, số lần đăng nhập sai sẽ được xóa và mọi phiên hiện tại sẽ bị thu hồi."}</Paragraph> : <Form.Item name="password" label="Mật khẩu tạm thời mới" rules={[{ required: true, message: "Nhập mật khẩu tạm thời." }]}><Input.Password autoComplete="new-password" /></Form.Item>}
      <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, max: 500, message: "Nhập lý do (tối đa 500 ký tự)." }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button danger={isStatus && canDisable(account)} type="primary" htmlType="submit" loading={mutation.isPending}>{isStatus ? (canDisable(account) ? "Vô hiệu hóa" : "Mở khóa") : "Đặt lại mật khẩu"}</Button></Space>
    </Form>
  </Modal>;
}

export function AccountsWorkspace({ user }: { user: AuthUser }) {
  const client = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: authApi.accounts });
  const context = useQuery({ queryKey: ["accounts-context"], queryFn: authApi.accountsContext });
  const [editor, setEditor] = useState<Account | null | undefined>(undefined);
  const [action, setAction] = useState<{ account: Account; kind: "status" | "password" } | null>(null);
  const revoke = useMutation({ mutationFn: authApi.revoke, onSuccess: () => void client.invalidateQueries({ queryKey: ["accounts"] }) });
  return <div className="content-stack">
    <div className="page-heading"><div><p className="eyebrow">QUẢN TRỊ / BẢO MẬT</p><Title level={1}>Tài khoản</Title><Paragraph type="secondary">Cấp quyền theo đơn vị và thời hạn, quản lý trạng thái, mật khẩu tạm thời và phiên đăng nhập.</Paragraph></div><Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setEditor(null)}>Tạo tài khoản</Button></div>
    {context.isError && <Alert type="error" showIcon message="Không tải được ngữ cảnh quản trị" description={errorMessage(context.error)} />}
    {revoke.isError && <Alert type="error" showIcon message="Không thể thu hồi phiên" description={errorMessage(revoke.error)} />}
    <section className="panel table-panel" tabIndex={0} aria-label="Bảng tài khoản">
      {accounts.isError ? <Alert type="error" showIcon message="Không tải được tài khoản" description={errorMessage(accounts.error)} /> : <Table<Account> rowKey="id" loading={accounts.isLoading} dataSource={accounts.data?.items ?? []} pagination={false} scroll={{ x: 1180 }} locale={{ emptyText: <Empty description="Không có tài khoản trong phạm vi quản trị" /> }} columns={[
        { title: "Tài khoản", key: "account", width: 210, render: (_, account) => <span><Text strong>{account.displayName}</Text><small className="table-subtext">{account.username}</small></span> },
        { title: "Vai trò / phạm vi", key: "grants", render: (_, account) => <Space size={[4, 4]} wrap>{account.assignments.map((grant) => <Tag key={grant.id}>{labelForRole(context.data, grant.roleCode)} · {grant.scopeCode}</Tag>)}</Space> },
        { title: "Trạng thái", key: "status", width: 150, render: (_, account) => <Space direction="vertical" size={2}><Tag color={account.status === "ACTIVE" ? "success" : "default"}>{account.status === "ACTIVE" ? "Đang hoạt động" : "Vô hiệu"}</Tag>{account.lockedUntil && <Text type="danger">Khóa đến {account.lockedUntil}</Text>}{account.requiresPasswordChange && <Text type="warning">Cần đổi mật khẩu</Text>}</Space> },
        { title: "Phiên", dataIndex: "sessionCount", width: 80, align: "right" },
        { title: "Thao tác", key: "action", width: 310, render: (_, account) => account.id === user.id ? <Text type="secondary">Dùng menu cá nhân để đổi mật khẩu.</Text> : <Space wrap><Button size="small" icon={<EditOutlined />} onClick={() => setEditor(account)}>Sửa</Button><Button size="small" icon={canDisable(account) ? <StopOutlined /> : <ReloadOutlined />} onClick={() => setAction({ account, kind: "status" })}>{canDisable(account) ? "Vô hiệu" : "Mở khóa"}</Button><Button size="small" icon={<KeyOutlined />} onClick={() => setAction({ account, kind: "password" })}>Đặt lại MK</Button><Popconfirm title="Thu hồi tất cả phiên?" description={`Các thiết bị đăng nhập bằng ${account.username} sẽ phải đăng nhập lại.`} okText="Thu hồi" cancelText="Hủy" onConfirm={() => revoke.mutate(account.id)}><Button size="small" danger loading={revoke.isPending && revoke.variables === account.id}>Thu hồi phiên</Button></Popconfirm></Space> },
      ]} />}
    </section>
    <AccountEditor account={editor ?? null} context={context.data} open={editor !== undefined} onClose={() => setEditor(undefined)} />
    <AccountAction account={action?.account ?? null} kind={action?.kind ?? null} open={Boolean(action)} onClose={() => setAction(null)} />
  </div>;
}
