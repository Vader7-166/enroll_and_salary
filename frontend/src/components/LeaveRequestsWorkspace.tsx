import { useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Pagination, Select, Space, Spin, Table, Tag, Typography } from "antd";
import { leaveApi } from "../api/leave";
import { leaveRequestsApi } from "../api/leave-requests";
import type { LeaveRequestAction, LeaveRequestInput, LeaveRequestStatus, LeaveRequestView } from "../api/leave-requests";
import { errorMessage } from "../api/client";
const { Title, Paragraph, Text } = Typography;
const needed = [{ required:true,message:"Trường này là bắt buộc." }];
const unitLabels = { DAY:"Ngày", HALF:"Nửa ngày", HOUR:"Theo giờ" };
const statusLabels: Record<LeaveRequestStatus,string> = { DRAFT:"Nháp", PENDING:"Chờ duyệt", RETURNED:"Trả lại", APPROVED:"Đã duyệt", REJECTED:"Từ chối", CANCELLED:"Đã hủy" };
const statusColors: Record<LeaveRequestStatus,string> = { DRAFT:"default", PENDING:"processing", RETURNED:"warning", APPROVED:"success", REJECTED:"error", CANCELLED:"default" };
const actionLabels: Record<LeaveRequestAction,string> = { approve:"Duyệt đơn nghỉ", return:"Trả lại đơn nghỉ", reject:"Từ chối đơn nghỉ", cancel:"Hủy đơn nghỉ" };
const historyLabels: Record<string,string> = { CREATE:"Lập nháp", UPDATE:"Sửa đơn", SUBMIT:"Gửi đơn", APPROVE:"Duyệt đơn", RETURN:"Trả lại", REJECT:"Từ chối", CANCEL:"Hủy đơn" };
function today() { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
function localInput(value?:string) { return value ? new Date(Date.parse(value)+7*3600000).toISOString().slice(0,16):undefined; }
function time(value:string) { return new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",dateStyle:"short",timeStyle:"short"}).format(new Date(value)); }
function TableBody(props:HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} tabIndex={0} aria-label="Dữ liệu đơn nghỉ" />; }
function preserveRequiredCombobox(select: { nativeElement: HTMLElement } | null) {
  // Match AccountsWorkspace: keep aria-required on the input, not the generic wrapper.
  select?.nativeElement.removeAttribute("aria-required");
}
function RequestEditor({item,onClose,onSaved}:{item:LeaveRequestView|null;onClose:()=>void;onSaved:(id:string)=>void}) {
 const [form]=Form.useForm<LeaveRequestInput>();
 const [search,setSearch]=useState("");
 const unit=Form.useWatch("unit",form)??item?.unit??"DAY";
 const from=Form.useWatch("dateFrom",form)??item?.dateFrom??today();
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(from)&&Number(from.slice(0,4))>=1900&&Number(from.slice(0,4))<=2200;
 const employees=useQuery({queryKey:["leave","request-employees",search,from.slice(0,4)],queryFn:()=>leaveApi.employees({year:Number(from.slice(0,4)),search,pageSize:100}),enabled:validDate});
 const types=useQuery({queryKey:["leave","types",from],queryFn:()=>leaveApi.types({asOf:from}),enabled:validDate});
 const mutation=useMutation({mutationFn:async(values:LeaveRequestInput)=>{
  const payload:LeaveRequestInput={employeeId:values.employeeId,leaveTypeId:values.leaveTypeId,dateFrom:values.dateFrom,dateTo:values.unit==="DAY"?values.dateTo:values.dateFrom,unit:values.unit,reason:values.reason.trim(),documentReference:values.documentReference?.trim()||undefined,...(values.unit==="HALF"?{half:values.half}:{}),...(values.unit==="HOUR"?{startAt:values.startAt+":00+07:00",endAt:values.endAt+":00+07:00"}:{})};
  return item?leaveRequestsApi.update(item.id,{...payload,revision:item.revision}):leaveRequestsApi.create(payload);
 },onSuccess:result=>onSaved(result.item.id)});
 const employeeOptions=employees.data?.items.map(e=>({value:e.id,label:e.code+" · "+e.fullName}))??[];
 if(item&&!employeeOptions.some(e=>e.value===item.employeeId)) employeeOptions.unshift({value:item.employeeId,label:item.preview.employee.code+" · "+item.preview.employee.fullName});
 return <Modal open title={item?(item.status==="RETURNED"?"Sửa đơn nghỉ trả lại":"Sửa đơn nghỉ nháp"):"Lập đơn nghỉ thay công nhân"} onCancel={onClose} footer={null} width={760} destroyOnHidden className="leave-request-editor">
  <Paragraph type="secondary">Giờ Việt Nam. Ngày nghỉ tính theo ca đã duyệt; nửa ngày là nửa đầu/cuối ca, không mặc định sáng/chiều. Ca đêm chọn đúng ngày kết thúc thực tế.</Paragraph>
  <Form form={form} layout="vertical" requiredMark="optional" initialValues={item?{...item,startAt:localInput(item.startAt),endAt:localInput(item.endAt)}:{unit:"DAY",dateFrom:today(),dateTo:today(),half:"FIRST"}} onFinish={values=>mutation.mutate(values)} disabled={mutation.isPending}>
   <Form.Item name="employeeId" label="Nhân sự" rules={needed}><Select ref={preserveRequiredCombobox} showSearch filterOption={false} onSearch={setSearch} loading={employees.isFetching} options={employeeOptions} placeholder="Tìm mã hoặc tên nhân sự trong tổ" /></Form.Item>
   <Form.Item name="leaveTypeId" label="Loại nghỉ" rules={needed}><Select ref={preserveRequiredCombobox} showSearch optionFilterProp="label" loading={types.isFetching} options={types.data?.items.flatMap(t=>{const v=t.versions.find(v=>v.effectiveFrom<=from&&(!v.effectiveTo||v.effectiveTo>=from));return v?.active?[{value:t.id,label:t.orgUnitCode+" · "+t.code+" · "+v.name}]:[];})} /></Form.Item>
   <div className="form-grid"><Form.Item name="unit" label="Đơn vị nghỉ" rules={needed}><Select ref={preserveRequiredCombobox} options={Object.entries(unitLabels).map(([value,label])=>({value,label}))} /></Form.Item>
   <Form.Item name="dateFrom" label={unit==="DAY"?"Từ ngày công":"Ngày công"} rules={needed}><Input type="date" min="1900-01-01" max="2200-12-31" /></Form.Item>
   {unit==="DAY"&&<Form.Item name="dateTo" label="Đến ngày công" rules={needed}><Input type="date" min="1900-01-01" max="2200-12-31" /></Form.Item>}
   {unit==="HALF"&&<Form.Item name="half" label="Phần ca nghỉ" rules={needed}><Select ref={preserveRequiredCombobox} options={[{value:"FIRST",label:"Nửa đầu ca"},{value:"SECOND",label:"Nửa cuối ca"}]} /></Form.Item>}
   {unit==="HOUR"&&<><Form.Item name="startAt" label="Bắt đầu nghỉ" rules={needed}><Input type="datetime-local" /></Form.Item><Form.Item name="endAt" label="Kết thúc nghỉ" rules={needed}><Input type="datetime-local" /></Form.Item></>}</div>
   <Form.Item name="reason" label="Lý do nghỉ" rules={[{required:true,whitespace:true,message:"Nhập lý do nghỉ."}]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
   <Form.Item name="documentReference" label="Tham chiếu chứng từ"><Input maxLength={500} placeholder="Số / nơi lưu chứng từ; bắt buộc khi loại nghỉ yêu cầu" /></Form.Item>
   {(employees.isError||types.isError)&&<Alert type="error" showIcon message="Không tải được danh mục" description={errorMessage(employees.error??types.error)} />}
   {mutation.isError&&<Alert type="error" showIcon message="Không lưu được đơn nghỉ" description={errorMessage(mutation.error)} />}
   <Space wrap><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu nháp</Button></Space>
  </Form>
 </Modal>;
}
function RequestDecision({item,action,onClose,onSaved}:{item:LeaveRequestView;action:LeaveRequestAction;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const [form]=Form.useForm<{reason?:string}>();
 const mutation=useMutation({mutationFn:({reason}:{reason?:string})=>leaveRequestsApi.transition(item.id,action,item.revision,reason?.trim()||undefined),onSuccess:async()=>{await onSaved();onClose();}});
 return <Modal open title={actionLabels[action]} footer={null} onCancel={()=>{if(!mutation.isPending)onClose();}} closable={!mutation.isPending} maskClosable={!mutation.isPending} destroyOnHidden className="leave-request-decision">
  <Paragraph><Text strong>{item.preview.employee.code+" · "+item.preview.employee.fullName}</Text><br />{item.dateFrom+" → "+item.dateTo} · {item.preview.totalDays} ngày / {item.preview.totalMinutes} phút<br />{statusLabels[item.status]} · Phiên bản {item.revision}</Paragraph>
   <Alert type="info" showIcon message={action==="approve"?"Duyệt đồng thời ghi sử dụng phép và cập nhật công":action==="cancel"&&item.status==="APPROVED"?"Hủy đồng thời hoàn phép và tính lại công":"Ghi trạng thái và lý do xử lý"} description="Ngày lễ L không trừ phép năm. Hoàn phép giữ nguyên nguồn và hạn dùng. Nghỉ không tạo giờ làm thực tế; ngày chưa có kỳ mở được ghi chờ xử lý công." />
  <Form form={form} layout="vertical" requiredMark="optional" disabled={mutation.isPending} onFinish={values=>mutation.mutate(values)}>
   <Form.Item name="reason" label={action==="approve"?"Ghi chú duyệt":"Lý do xử lý"} rules={action==="approve"?[]:[{required:true,whitespace:true,message:"Nhập lý do xử lý đơn nghỉ."}]}><Input.TextArea rows={3} maxLength={2000} showCount autoFocus /></Form.Item>
   {mutation.isError&&<Alert type="error" showIcon message="Không xử lý được đơn nghỉ" description={errorMessage(mutation.error)} />}
   <Space wrap><Button onClick={onClose} disabled={mutation.isPending}>Quay lại</Button><Button type="primary" danger={action==="reject"||action==="cancel"} htmlType="submit" loading={mutation.isPending}>{actionLabels[action]}</Button></Space>
  </Form>
 </Modal>;
}
export function LeaveRequestsWorkspace({canPlan}:{canPlan:boolean}) {
 const client=useQueryClient();
 const [search,setSearch]=useState(""),[status,setStatus]=useState(""),[page,setPage]=useState(1);
 const [selected,setSelected]=useState<string|null>(null),[editing,setEditing]=useState<LeaveRequestView|null|undefined>(undefined);
 const [decision,setDecision]=useState<{item:LeaveRequestView;action:LeaveRequestAction}|null>(null);
 const list=useQuery({queryKey:["leave","requests",search,status,page],queryFn:()=>leaveRequestsApi.list(search,status,page)});
 const detail=useQuery({queryKey:["leave","request",selected],queryFn:()=>leaveRequestsApi.detail(selected!),enabled:Boolean(selected)});
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:["leave"]}),client.invalidateQueries({queryKey:["attendance"]})]);};
 const submit=useMutation({mutationFn:(item:LeaveRequestView)=>leaveRequestsApi.submit(item.id,item.revision),onSuccess:refresh});
 const item=detail.data?.item;
 return <>
   <div className="leave-heading"><div><Title level={2}>Đơn nghỉ</Title><Paragraph type="secondary">Tổ trưởng ghi nhận và duyệt một cấp trong phạm vi được cấp. Duyệt/hủy cập nhật quỹ phép và công; ngày lễ không trừ phép năm.</Paragraph></div><Space wrap><Button onClick={()=>void refresh()}>Tải lại</Button>{canPlan&&<Button type="primary" onClick={()=>setEditing(null)}>Lập đơn nghỉ</Button>}</Space></div>
  <Space wrap className="leave-filters"><Input.Search aria-label="Tìm đơn nghỉ" placeholder="Mã hoặc tên nhân sự" onSearch={v=>{setSearch(v.trim());setPage(1);}} allowClear /><Select aria-label="Trạng thái đơn nghỉ" virtual={false} getPopupContainer={trigger=>trigger.parentElement!} value={status} onChange={v=>{setStatus(v);setPage(1);}} options={[{value:"",label:"Tất cả trạng thái"},...Object.entries(statusLabels).map(([value,label])=>({value,label}))]} /></Space>
  {list.isError&&<Alert type="error" message="Không tải được đơn nghỉ" description={errorMessage(list.error)} showIcon />}
  <Table rowKey="id" loading={list.isLoading} dataSource={list.data?.items??[]} pagination={false} scroll={{x:960}} components={{body:{wrapper:TableBody}}} locale={{emptyText:<Empty description="Chưa có đơn nghỉ trong phạm vi" />}} columns={[
   {title:"Nhân sự",render:(_,r:LeaveRequestView)=><><Text strong>{r.preview.employee.fullName}</Text><small className="table-subtext">{r.preview.employee.code}</small></>},
   {title:"Loại nghỉ",render:(_,r:LeaveRequestView)=>r.preview.leaveType.name},
   {title:"Thời gian",render:(_,r:LeaveRequestView)=>r.dateFrom+(r.dateTo!==r.dateFrom?" → "+r.dateTo:"")},
   {title:"Đơn vị",render:(_,r:LeaveRequestView)=>unitLabels[r.unit]},
   {title:"Thời lượng",render:(_,r:LeaveRequestView)=>r.preview.totalDays+" ngày / "+r.preview.totalMinutes+" phút"},
   {title:"Trạng thái",render:(_,r:LeaveRequestView)=><Tag color={statusColors[r.status]}>{statusLabels[r.status]}</Tag>},
   {title:"Thao tác",render:(_,r:LeaveRequestView)=><Button onClick={()=>{setSelected(r.id);submit.reset();}}>Chi tiết</Button>}
  ]} />
  <Pagination current={page} total={list.data?.total??0} pageSize={20} showSizeChanger={false} onChange={setPage} />
  <Drawer open={Boolean(selected)} title="Chi tiết đơn nghỉ" width={880} onClose={()=>setSelected(null)} className="leave-drawer" destroyOnHidden>
   {detail.isLoading?<Spin tip="Đang tải đơn nghỉ…" />:detail.isError?<Alert type="error" message="Không tải được đơn nghỉ" description={errorMessage(detail.error)} />:item&&<>
    <Descriptions bordered size="small" column={1} items={[{key:"person",label:"Nhân sự",children:item.preview.employee.code+" · "+item.preview.employee.fullName},{key:"type",label:"Loại nghỉ",children:item.preview.leaveType.name},{key:"status",label:"Trạng thái",children:statusLabels[item.status]},{key:"reason",label:"Lý do",children:item.reason},{key:"document",label:"Chứng từ",children:item.documentReference||"Chưa cung cấp"},{key:"amount",label:"Thời lượng theo ca",children:item.preview.totalDays+" ngày / "+item.preview.totalMinutes+" phút"},{key:"revision",label:"Phiên bản",children:item.revision}]} />
    {item.preview.warnings.map((w,i)=><Alert key={i} type="warning" showIcon message={w} />)}
       <Alert type={item.integration.status?"success":"info"} showIcon message={item.integration.status==="APPLIED"?"Đã tích hợp đơn nghỉ":item.integration.status==="REVERSED"?"Đã ghi nhận hoàn phép và hủy ảnh hưởng đơn":"Chưa phát sinh bút toán sử dụng phép"} description={item.integration.status?"Bút toán bất biến, gắn mã đơn và người xử lý. Nghỉ có lương/tính công theo loại nghỉ; không cộng vào phút làm thực tế.":"Nháp/chờ duyệt/trả lại/từ chối không giữ chỗ quỹ phép. Số dư được kiểm tra lại lúc duyệt."} />
        {item.integration.attendance?.some(a=>a.state!=="UPDATED")&&<Alert type="warning" showIcon message="Có ngày chờ xử lý công" description="Bút toán quỹ đã ghi nhận theo thao tác. Tạo/mở kỳ tương ứng rồi xử lý công; nguồn nghỉ được đồng bộ theo trạng thái hiện tại." />}
      {item.integration.status&&<Descriptions size="small" column={1} items={[{key:"used",label:"Bút toán sử dụng",children:item.integration.useOperationIds?.length??0},{key:"refund",label:"Bút toán hoàn",children:item.integration.refundOperationIds?.length??0},{key:"updated",label:"Cập nhật công",children:item.integration.attendance?.map(a=><div key={a.scheduleId}>{a.workDate+" · "+(a.state==="UPDATED"?"Đã cập nhật":a.state==="WAITING_PERIOD"?"Chờ kỳ mở":"Chờ xử lý công")}{a.dayId&&<Text type="secondary"> · {a.dayId}</Text>}</div>)}]} />}
     {item.preview.balances.map(b=><Paragraph key={b.year}>Quỹ {b.year}: {b.requestedDays} ngày trừ phép (không gồm ngày lễ); khả dụng khi kiểm tra {b.availableDays} ngày.</Paragraph>)}
     <Title level={3}>Chi tiết theo ngày công</Title><Table rowKey="workDate" size="small" pagination={false} dataSource={item.preview.lines} scroll={{x:650}} components={{body:{wrapper:TableBody}}} columns={[{title:"Ngày công",dataIndex:"workDate"},{title:"Ký hiệu",render:(_,l)=><Tag>{l.attendanceSymbol}</Tag>},{title:"Trừ phép",render:(_,l)=>l.deductsAnnualQuota?l.days+" ngày":"Không"},{title:"Ca",dataIndex:"shiftCode"},{title:"Bắt đầu",render:(_,l)=>time(l.startAt)},{title:"Kết thúc",render:(_,l)=>time(l.endAt)},{title:"Phút nghỉ",dataIndex:"minutes"},{title:"Ngày quy đổi",dataIndex:"days"}]} />
    {canPlan&&<Space wrap>
     {["DRAFT","RETURNED"].includes(item.status)&&<><Button disabled={submit.isPending} onClick={()=>setEditing(item)}>{item.status==="RETURNED"?"Sửa đơn trả lại":"Sửa nháp"}</Button><Button type="primary" loading={submit.isPending} onClick={()=>submit.mutate(item)}>Gửi đơn nghỉ</Button></>}
     {item.status==="PENDING"&&<><Button type="primary" onClick={()=>setDecision({item,action:"approve"})}>Duyệt đơn nghỉ</Button><Button onClick={()=>setDecision({item,action:"return"})}>Trả lại</Button><Button danger onClick={()=>setDecision({item,action:"reject"})}>Từ chối</Button></>}
     {["DRAFT","RETURNED","PENDING","APPROVED"].includes(item.status)&&<Button danger disabled={submit.isPending} onClick={()=>setDecision({item,action:"cancel"})}>Hủy đơn nghỉ</Button>}
    </Space>}
    {submit.isError&&<Alert type="error" message="Không gửi được đơn nghỉ" description={errorMessage(submit.error)} showIcon />}
    <Title level={3}>Lịch sử đơn nghỉ</Title>{detail.data?.history.map(h=><details key={h.id}><summary>{time(h.occurredAt)} · {h.actor.displayName} · {historyLabels[h.action]} · Phiên bản {h.revision}</summary><Paragraph>{h.fromStatus?statusLabels[h.fromStatus]+" → ":""}{statusLabels[h.snapshot.status]}{h.reason?" · Lý do xử lý: "+h.reason:""}</Paragraph><Paragraph>{h.snapshot.reason} · {h.snapshot.dateFrom} → {h.snapshot.dateTo} · {h.snapshot.preview.totalDays} ngày</Paragraph></details>)}
   </>}
  </Drawer>
  {editing!==undefined&&<RequestEditor key={editing?.id??"new"} item={editing} onClose={()=>setEditing(undefined)} onSaved={id=>{setEditing(undefined);setSelected(id);void refresh();}} />}
  {decision&&<RequestDecision key={decision.item.id+decision.action+decision.item.revision} item={decision.item} action={decision.action} onClose={()=>setDecision(null)} onSaved={async()=>{submit.reset();await refresh();}} />}
 </>;
}
