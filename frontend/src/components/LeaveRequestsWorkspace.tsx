import { useState } from "react";
import type { HTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Pagination, Select, Space, Spin, Table, Tag, Typography } from "antd";
import { leaveApi } from "../api/leave";
import { leaveRequestsApi } from "../api/leave-requests";
import type { LeaveRequestInput, LeaveRequestView } from "../api/leave-requests";
import { errorMessage } from "../api/client";
const { Title, Paragraph, Text } = Typography;
const needed = [{ required:true,message:"Trường này là bắt buộc." }];
const unitLabels = { DAY:"Ngày", HALF:"Nửa ngày", HOUR:"Theo giờ" };
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
 return <Modal open title={item?"Sửa đơn nghỉ nháp":"Lập đơn nghỉ thay công nhân"} onCancel={onClose} footer={null} width={760} destroyOnHidden className="leave-request-editor">
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
export function LeaveRequestsWorkspace({canPlan}:{canPlan:boolean}) {
 const client=useQueryClient();
 const [search,setSearch]=useState(""),[status,setStatus]=useState(""),[page,setPage]=useState(1);
 const [selected,setSelected]=useState<string|null>(null),[editing,setEditing]=useState<LeaveRequestView|null|undefined>(undefined);
 const list=useQuery({queryKey:["leave","requests",search,status,page],queryFn:()=>leaveRequestsApi.list(search,status,page)});
 const detail=useQuery({queryKey:["leave","request",selected],queryFn:()=>leaveRequestsApi.detail(selected!),enabled:Boolean(selected)});
 const refresh=()=>client.invalidateQueries({queryKey:["leave"]});
 const submit=useMutation({mutationFn:(item:LeaveRequestView)=>leaveRequestsApi.submit(item.id,item.revision),onSuccess:refresh});
 const item=detail.data?.item;
 return <>
  <div className="leave-heading"><div><Title level={2}>Đơn nghỉ</Title><Paragraph type="secondary">Tổ trưởng lập thay công nhân. Gửi đơn chưa trừ quỹ phép, chưa ghi công.</Paragraph></div><Space wrap><Button onClick={()=>void refresh()}>Tải lại</Button>{canPlan&&<Button type="primary" onClick={()=>setEditing(null)}>Lập đơn nghỉ</Button>}</Space></div>
  <Space wrap className="leave-filters"><Input.Search aria-label="Tìm đơn nghỉ" placeholder="Mã hoặc tên nhân sự" onSearch={v=>{setSearch(v.trim());setPage(1);}} allowClear /><Select aria-label="Trạng thái đơn nghỉ" value={status} onChange={v=>{setStatus(v);setPage(1);}} options={[{value:"",label:"Tất cả trạng thái"},{value:"DRAFT",label:"Nháp"},{value:"PENDING",label:"Chờ duyệt"}]} /></Space>
  {list.isError&&<Alert type="error" message="Không tải được đơn nghỉ" description={errorMessage(list.error)} showIcon />}
  <Table rowKey="id" loading={list.isLoading} dataSource={list.data?.items??[]} pagination={false} scroll={{x:960}} components={{body:{wrapper:TableBody}}} locale={{emptyText:<Empty description="Chưa có đơn nghỉ trong phạm vi" />}} columns={[
   {title:"Nhân sự",render:(_,r:LeaveRequestView)=><><Text strong>{r.preview.employee.fullName}</Text><small className="table-subtext">{r.preview.employee.code}</small></>},
   {title:"Loại nghỉ",render:(_,r:LeaveRequestView)=>r.preview.leaveType.name},
   {title:"Thời gian",render:(_,r:LeaveRequestView)=>r.dateFrom+(r.dateTo!==r.dateFrom?" → "+r.dateTo:"")},
   {title:"Đơn vị",render:(_,r:LeaveRequestView)=>unitLabels[r.unit]},
   {title:"Thời lượng",render:(_,r:LeaveRequestView)=>r.preview.totalDays+" ngày / "+r.preview.totalMinutes+" phút"},
   {title:"Trạng thái",render:(_,r:LeaveRequestView)=><Tag color={r.status==="PENDING"?"processing":"default"}>{r.status==="PENDING"?"Chờ duyệt":"Nháp"}</Tag>},
   {title:"Thao tác",render:(_,r:LeaveRequestView)=><Button onClick={()=>{setSelected(r.id);submit.reset();}}>Chi tiết</Button>}
  ]} />
  <Pagination current={page} total={list.data?.total??0} pageSize={20} showSizeChanger={false} onChange={setPage} />
  <Drawer open={Boolean(selected)} title="Chi tiết đơn nghỉ" width={880} onClose={()=>setSelected(null)} className="leave-drawer" destroyOnHidden>
   {detail.isLoading?<Spin tip="Đang tải đơn nghỉ…" />:detail.isError?<Alert type="error" message="Không tải được đơn nghỉ" description={errorMessage(detail.error)} />:item&&<>
    <Descriptions bordered size="small" column={1} items={[{key:"person",label:"Nhân sự",children:item.preview.employee.code+" · "+item.preview.employee.fullName},{key:"type",label:"Loại nghỉ",children:item.preview.leaveType.name},{key:"status",label:"Trạng thái",children:item.status==="PENDING"?"Chờ duyệt":"Nháp"},{key:"reason",label:"Lý do",children:item.reason},{key:"document",label:"Chứng từ",children:item.documentReference||"Chưa cung cấp"},{key:"amount",label:"Thời lượng theo ca",children:item.preview.totalDays+" ngày / "+item.preview.totalMinutes+" phút"},{key:"revision",label:"Phiên bản",children:item.revision}]} />
    {item.preview.warnings.map((w,i)=><Alert key={i} type="warning" showIcon message={w} />)}
    <Alert type="info" showIcon message="Thời lượng theo lịch ca đã duyệt; chưa phải bút toán trừ phép hay ký hiệu công. Ngày lễ và tác động công được xử lý ở bước tích hợp nghỉ đã duyệt." />
    {item.preview.balances.map(b=><Paragraph key={b.year}>Quỹ {b.year}: đề nghị {b.requestedDays} ngày; khả dụng tại ngày nghỉ {b.availableDays} ngày. Chưa giữ chỗ số dư.</Paragraph>)}
    <Title level={3}>Chi tiết theo ngày công</Title><Table rowKey="workDate" size="small" pagination={false} dataSource={item.preview.lines} scroll={{x:650}} components={{body:{wrapper:TableBody}}} columns={[{title:"Ngày công",dataIndex:"workDate"},{title:"Ca",dataIndex:"shiftCode"},{title:"Bắt đầu",render:(_,l)=>time(l.startAt)},{title:"Kết thúc",render:(_,l)=>time(l.endAt)},{title:"Phút nghỉ",dataIndex:"minutes"},{title:"Ngày quy đổi",dataIndex:"days"}]} />
    {canPlan&&item.status==="DRAFT"&&<Space wrap><Button onClick={()=>setEditing(item)}>Sửa nháp</Button><Button type="primary" loading={submit.isPending} onClick={()=>submit.mutate(item)}>Gửi đơn nghỉ</Button></Space>}
    {submit.isError&&<Alert type="error" message="Không gửi được đơn nghỉ" description={errorMessage(submit.error)} showIcon />}
    <Title level={3}>Lịch sử đơn nghỉ</Title>{detail.data?.history.map(h=><details key={h.id}><summary>{time(h.occurredAt)} · {h.actor.displayName} · {({CREATE:"Lập nháp",UPDATE:"Sửa nháp",SUBMIT:"Gửi đơn"} as Record<string,string>)[h.action]} · Phiên bản {h.revision}</summary><Paragraph>{h.snapshot.reason} · {h.snapshot.dateFrom} → {h.snapshot.dateTo} · {h.snapshot.preview.totalDays} ngày</Paragraph></details>)}
   </>}
  </Drawer>
  {editing!==undefined&&<RequestEditor key={editing?.id??"new"} item={editing} onClose={()=>setEditing(undefined)} onSaved={id=>{setEditing(undefined);setSelected(id);void refresh();}} />}
 </>;
}
