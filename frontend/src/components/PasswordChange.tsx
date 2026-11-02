import { Alert, Button, Form, Input, Modal, Space, Typography } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorMessage } from "../api/client";
import { authApi, type PasswordPolicy } from "../api/hrtp";

const { Paragraph, Text, Title } = Typography;

type PasswordValues = { currentPassword: string; newPassword: string; confirmation: string };

function policyDescription(policy: PasswordPolicy | undefined) {
  if (!policy) return "Đang tải chính sách mật khẩu…";
  const requirements = [`tối thiểu ${policy.minLength} ký tự`];
  if (policy.requireUppercase) requirements.push("một chữ hoa");
  if (policy.requireLowercase) requirements.push("một chữ thường");
  if (policy.requireNumber) requirements.push("một chữ số");
  if (policy.requireSymbol) requirements.push("một ký tự đặc biệt");
  const age = policy.maxAgeDays ? `; hết hạn sau ${policy.maxAgeDays} ngày` : "; không tự hết hạn";
  return "Mật khẩu cần " + requirements.join(", ") + age + ".";
}

function passwordRule(policy: PasswordPolicy | undefined) {
  return (_: unknown, value?: string) => {
    if (!value || !policy) return Promise.resolve();
    const valid = value.length >= policy.minLength
      && value.length <= 128
      && (!policy.requireUppercase || /\p{Lu}/u.test(value))
      && (!policy.requireLowercase || /\p{Ll}/u.test(value))
      && (!policy.requireNumber || /[0-9]/.test(value))
      && (!policy.requireSymbol || /[^\p{L}\p{N}\s]/u.test(value));
    return valid ? Promise.resolve() : Promise.reject(new Error(policyDescription(policy)));
  };
}

function PasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [form] = Form.useForm<PasswordValues>();
  const policy = useQuery({ queryKey: ["password-policy"], queryFn: authApi.passwordPolicy, retry: false });
  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: PasswordValues) => authApi.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      form.resetFields();
      onSuccess();
    },
  });
  return (
    <Form form={form} layout="vertical" requiredMark="optional" onFinish={(values) => mutation.mutate(values)} disabled={mutation.isPending} autoComplete="on">
      {policy.isError && <Alert className="form-alert" type="error" showIcon message="Không tải được chính sách mật khẩu" description={errorMessage(policy.error)} />}
      {mutation.isError && <Alert className="form-alert" type="error" showIcon message="Không thể đổi mật khẩu" description={errorMessage(mutation.error)} />}
      <Paragraph type="secondary">{policyDescription(policy.data?.policy)}</Paragraph>
      <Form.Item name="currentPassword" label="Mật khẩu hiện tại" rules={[{ required: true, message: "Nhập mật khẩu hiện tại." }]}>
        <Input.Password autoComplete="current-password" autoFocus />
      </Form.Item>
      <Form.Item name="newPassword" label="Mật khẩu mới" rules={[{ required: true, message: "Nhập mật khẩu mới." }, { validator: passwordRule(policy.data?.policy) }]}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item name="confirmation" label="Xác nhận mật khẩu mới" dependencies={["newPassword"]} rules={[{ required: true, message: "Nhập lại mật khẩu mới." }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("Mật khẩu xác nhận không khớp.")) })]}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Space className="modal-actions">
        <Button type="primary" htmlType="submit" loading={mutation.isPending} disabled={policy.isLoading}>Đổi mật khẩu</Button>
      </Space>
      <Text type="secondary">Sau khi đổi mật khẩu, toàn bộ phiên đăng nhập sẽ kết thúc. Hãy đăng nhập lại.</Text>
    </Form>
  );
}

export function PasswordChangeDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  return <Modal title="Đổi mật khẩu" open={open} onCancel={onClose} footer={null} destroyOnHidden><PasswordForm onSuccess={onSuccess} /></Modal>;
}

export function ForcedPasswordChange({ onSuccess }: { onSuccess: () => void }) {
  return (
    <main className="login-page" aria-labelledby="change-password-title">
      <section className="login-panel">
        <div className="login-brand"><img src="/favicon.svg" alt="" width="40" height="40" /><div><strong>HRTP</strong><span>Chấm công & tiền lương</span></div></div>
        <div><p className="eyebrow">BẢO MẬT TÀI KHOẢN</p><Title id="change-password-title" level={1}>Cần đổi mật khẩu</Title><Paragraph type="secondary">Mật khẩu tạm thời hoặc mật khẩu đã hết hạn phải được thay đổi trước khi tiếp tục.</Paragraph></div>
        <PasswordForm onSuccess={onSuccess} />
        <Button onClick={() => void authApi.logout().finally(onSuccess)}>Đăng xuất</Button>
      </section>
    </main>
  );
}
