import { RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Grid, Input, List, Space, Spin, Tag, Typography } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage, ApiError } from "../api/client";
import { assistantApi } from "../api/assistant";
import type { AssistantAnswer, AssistantGuideItem } from "../api/assistant";

const { Text, Paragraph, Title } = Typography;

function Guide({ items, onOpen }: { items: AssistantGuideItem[]; onOpen: (route: string) => void }) {
  if (!items.length) return <Empty description="Chưa có hướng dẫn cho trang này" />;
  return <List dataSource={items} renderItem={item => <List.Item><div>
    <Text strong>{item.title}</Text> {item.label === "SIMULATION" && <Tag>Mô phỏng</Tag>}
    <Paragraph className="assistant-text">{item.text}</Paragraph>
    <Space wrap>{item.actions.map(action => <Button key={action.actionKey} size="small" onClick={() => onOpen(action.route)}>{action.label}</Button>)}</Space>
  </div></List.Item>} />;
}

/**
 * AI-02 drawer (docs 24 §7): role-filtered suggestions, answer steps with sources, backend-built links and limitations.
 * Content lives only in this component; the shell remounts it per account, and a permission change clears it.
 */
export function AssistantButton({ pageKey, onNavigate }: { pageKey: string; onNavigate: (route: string) => void }) {
  const screens = Grid.useBreakpoint();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const context = useQuery({ queryKey: ["assistant-context", pageKey], queryFn: () => assistantApi.context(pageKey), retry: false, staleTime: 60_000 });
  const guide = useQuery({ queryKey: ["assistant-guide", pageKey], queryFn: () => assistantApi.guide(pageKey), enabled: open && (!answer || answer.status !== "ANSWERED") });
  const ask = useMutation({ mutationFn: (text: string) => assistantApi.ask(text, pageKey), onSuccess: setAnswer,
    onError: error => { if (error instanceof ApiError && (error.status === 401 || error.code === "SCOPE_CHANGED")) { setAnswer(null); setQuestion(""); } } });
  useEffect(() => { setAnswer(null); ask.reset(); }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!context.data?.enabled) return null;
  const go = (route: string) => { setOpen(false); onNavigate(route.replace(/^#\//, "")); };
  const submit = (text: string) => { const value = text.trim(); if (value.length >= 3) { setQuestion(value); ask.mutate(value); } };
  return <>
    <Button type="text" icon={<RobotOutlined />} onClick={() => setOpen(true)} aria-label="Mở Trợ lý AI">Trợ lý AI</Button>
    <Drawer title="Trợ lý AI" placement="right" width={screens.md ? 440 : "100%"} open={open} onClose={() => setOpen(false)} destroyOnHidden>
      <div className="tab-stack">
        <Space wrap><Tag color="blue">{context.data.label}</Tag><Text type="secondary">Vai trò {context.data.roles.join(", ")} · trang {pageKey}</Text></Space>
        <Alert type="info" showIcon message="Không nhập CCCD, mã số thuế, số tài khoản, điện thoại hay email. Trợ lý chỉ hướng dẫn từ tài liệu, không xem dữ liệu thực tế và không thao tác thay bạn." />
        {context.data.suggestions.length > 0 && <Space wrap>{context.data.suggestions.map(item => <Button key={item} size="small" onClick={() => submit(item)}>{item}</Button>)}</Space>}
        <Input.TextArea autoFocus rows={3} maxLength={context.data.maxQuestionChars} showCount value={question} onChange={event => setQuestion(event.target.value)} placeholder="Hỏi về quy trình, ví dụ: thiếu lượt ra xử lý thế nào?" aria-label="Câu hỏi cho Trợ lý AI" />
        <Button type="primary" loading={ask.isPending} disabled={question.trim().length < 3} onClick={() => submit(question)}>Hỏi</Button>
        {ask.isPending && <Spin tip="Đang tìm trong tài liệu…" />}
        {ask.isError && <Alert type="error" showIcon message={errorMessage(ask.error)} />}
        {answer?.status === "ANSWERED" && <div className="tab-stack" aria-live="polite">
          {answer.answer && <Paragraph>{answer.answer}</Paragraph>}
          <ol className="assistant-steps">{answer.steps.map((step, index) => <li key={index}>{step.text} <Text type="secondary">[{step.sourceIds.join(", ")}]</Text></li>)}</ol>
          {answer.actions.length > 0 && <Space wrap>{answer.actions.map(action => <Button key={action.actionKey} onClick={() => go(action.route)}>{action.label}</Button>)}</Space>}
          <div><Text strong>Nguồn</Text><ul className="plain-list">{answer.citations.map(citation => <li key={citation.sourceId}>{citation.sourceId} — {citation.title} ({citation.section}){citation.label === "SIMULATION" && <Tag className="assistant-tag">Mô phỏng</Tag>}</li>)}</ul></div>
          {answer.limitations.map(item => <Alert key={item} type="warning" showIcon message={item} />)}
        </div>}
        {answer && answer.status !== "ANSWERED" && <Alert type={answer.status === "UNAVAILABLE" ? "warning" : "info"} showIcon message={answer.answer} description={answer.status === "UNAVAILABLE" ? "Dùng hướng dẫn tĩnh bên dưới; chấm công và tiền lương không bị ảnh hưởng." : undefined} />}
        {(!answer || answer.status !== "ANSWERED") && <><Title level={5}>Hướng dẫn tĩnh</Title>{guide.isLoading ? <Spin /> : <Guide items={answer?.fallback?.items ?? guide.data?.items ?? []} onOpen={go} />}</>}
      </div>
    </Drawer>
  </>;
}
