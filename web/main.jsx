import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Layers3, Plus, ChevronRight, ArrowLeft, ArrowUp, ArrowDown, Globe2, Network, Cable, Settings2, Copy, Check, Save, Undo2, RefreshCw, Play, Square, Trash2, X, Eye, EyeOff, Download, FileCode2, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import "./style.css";
import { Bot, ExternalLink, Link } from "lucide-react";

function AgentAccess() {
  const [open, setOpen] = useState(false), [feedback, setFeedback] = useState("");
  const endpoints = [["Skill", `${location.origin}/api/skill`], ["API 详情", `${location.origin}/api/docs`]];
  async function copyText(value, message) {
    try { await navigator.clipboard.writeText(value); setFeedback(message); }
    catch { setFeedback("复制失败，请重试。"); }
  }
  return <><Tool label="Agent 接入" onClick={() => { setFeedback(""); setOpen(true); }}><Bot size={18} /></Tool><Dialog open={open} onOpenChange={setOpen}><DialogContent className="agent-dialog"><DialogHeader><DialogTitle>Agent 接入</DialogTitle><DialogDescription>仅限本机访问</DialogDescription></DialogHeader><div className="agent-endpoints">{endpoints.map(([name, address]) => <div className="agent-endpoint" key={name}><div><strong>{name}</strong><code>{address}</code></div><div className="agent-tools"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" asChild><a href={address} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${name}`}><ExternalLink size={18} /></a></Button></TooltipTrigger><TooltipContent>打开 {name}</TooltipContent></Tooltip><Tool label={`复制 ${name} 地址`} onClick={() => copyText(address, `${name} 地址已复制`)}><Link size={18} /></Tool><Tool label={`复制 ${name} 接入说明`} onClick={() => copyText(`${name}: ${address}`, `${name} 接入说明已复制`)}><Copy size={18} /></Tool></div></div>)}</div><Button variant="outline" onClick={() => copyText(`Clash Merge Agent 接入\n服务地址: ${location.origin}\nSkill: ${endpoints[0][1]}\nAPI 文档: ${endpoints[1][1]}\n先读取 Skill 和 API 文档，再根据用户要求操作。接口仅限本机访问；修改配置请使用 ETag / If-Match 避免覆盖其他更改。`, "Agent 接入信息已复制")}><Copy size={18} />复制 Agent 接入信息</Button><p className="agent-feedback" role="status">{feedback}</p></DialogContent></Dialog></>;
}

const TYPES = { ssh: "SSH 隧道", socks5: "SOCKS5", http: "HTTP 代理" };
const clone = value => structuredClone(value);
const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "请求失败，请重试。");
  return { data, etag: response.headers.get("etag") };
}
function Tool({ label, children, ...props }) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
function Field({ label, children, wide }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}
function Choice({ label, value, onChange, options }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(([id, name]) => <SelectItem value={id} key={id}>{name}</SelectItem>)}</SelectContent></Select>;
}
function exitState(exit, status) {
  if (!exit.enabled) return ["已停用", "neutral"];
  if (!status) return ["等待检查", "neutral"];
  if (status.busy || ["connecting", "retrying"].includes(status.state)) return [status.state === "retrying" ? "正在重试" : "正在连接", "amber"];
  if (status.state === "connected") return ["守护运行中", "green"];
  if (status.socksListening || status.listening) return [status.managed ? "端口已监听" : "外部进程 · 端口已监听", "blue"];
  if (status.state === "error") return ["守护异常", "red"];
  if (status.state === "external" && exit.type === "ssh") return ["端口被占用", "amber"];
  return [exit.type === "ssh" ? "守护未启动" : "端口未连接", "neutral"];
}
function State({ value }) { return <span className={`state ${value[1]}`}><span className="dot" />{value[0]}</span>; }

function App() {
  const [doc, setDoc] = useState(null), [saved, setSaved] = useState(null), [etag, setEtag] = useState(null);
  const [defaults, setDefaults] = useState(null), [profiles, setProfiles] = useState([]);
  const [planId, setPlanId] = useState(""), [view, setView] = useState("overview"), [exitId, setExitId] = useState("");
  const [health, setHealth] = useState(null), [statuses, setStatuses] = useState({}), [notice, setNotice] = useState(null);
  const [loadingError, setLoadingError] = useState(""), [saving, setSaving] = useState(false), [refreshing, setRefreshing] = useState(false), [working, setWorking] = useState(false);
  const [modal, setModal] = useState(null), [name, setName] = useState(""), [type, setType] = useState("ssh"), [deleting, setDeleting] = useState(null);
  const [domains, setDomains] = useState(""), [filter, setFilter] = useState(""), [showUrl, setShowUrl] = useState(false);
  const [preview, setPreview] = useState(null), [previewBusy, setPreviewBusy] = useState(false), [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState(null), [draft, setDraft] = useState(null), [formError, setFormError] = useState(""), [step, setStep] = useState(1), [exitSearch, setExitSearch] = useState(""), [stateFilter, setStateFilter] = useState("all"), [domainPage, setDomainPage] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const plan = doc?.plans.find(item => item.id === planId);
  const exit = plan?.exits.find(item => item.id === exitId);
  const status = statuses[exitId];
  const dirty = !!doc && JSON.stringify(doc) !== JSON.stringify(saved);
  const persisted = saved?.plans.some(item => item.id === planId);
  const selection = useRef(planId); selection.current = planId;
  const url = `${location.origin}/subscriptions/${planId}/clash.yaml`;
  const notify = (text, error = false) => setNotice({ text, error });
  async function load() {
    setLoadingError("");
    try {
      const [settings, initial, sources] = await Promise.all([api("/api/settings"), api("/api/defaults"), api("/api/profiles")]);
      setDoc(settings.data); setSaved(clone(settings.data)); setEtag(settings.etag); setDefaults(initial.data); setProfiles(sources.data); setPlanId(settings.data.defaultPlanId);
    } catch (error) { setLoadingError(error.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const handler = event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    setStatuses({}); setHealth(null); setPreview(null);
    if (!persisted) return;
    let active = true;
    async function poll() {
      try {
        const [states, report] = await Promise.all([api(`/api/plans/${planId}/exits`), api(`/api/plans/${planId}/health`)]);
        if (active) { setStatuses(states.data); setHealth(report.data); }
      } catch { if (active) setHealth({ status: "unavailable" }); }
    }
    poll(); const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [planId, saved]);
  function choosePlan(id) { setPlanId(id); setView("overview"); setExitId(""); setPreview(null); setShowUrl(false); setNotice(null); setExitSearch(""); setStateFilter("all"); }
  function chooseExit(id) { setExitId(id); setView("overview"); setDomains(""); setFilter(""); setDomainPage(0); }
  useEffect(() => { if (plan && !plan.exits.some(item => item.id === exitId)) setExitId(plan.exits[0]?.id || ""); }, [plan, exitId]);
  function updatePlan(changes) { setDoc(current => ({ ...current, plans: current.plans.map(item => item.id === planId ? { ...item, ...changes } : item) })); }
  function updateExit(changes) { updatePlan({ exits: plan.exits.map(item => item.id === exitId ? { ...item, ...changes } : item) }); }
  function updateTunnel(key, value) { updateExit({ tunnel: { ...exit.tunnel, [key]: value }, ...(key === "socksPort" ? { port: value } : {}) }); }
  async function save() {
    const snapshot = clone(doc); setSaving(true);
    try {
      const result = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(snapshot) });
      setSaved(clone(result.data)); setEtag(result.etag); setDoc(current => JSON.stringify(current) === JSON.stringify(snapshot) ? result.data : current); setPreview(null);
      notify("配置已保存。更新 Clash 中的方案订阅后生效。");
    } catch (error) { notify(error.message, true); }
    finally { setSaving(false); }
  }
  function undo() { setDoc(clone(saved)); if (!saved.plans.some(item => item.id === planId)) choosePlan(saved.defaultPlanId); else if (!saved.plans.find(item => item.id === planId).exits.some(item => item.id === exitId)) setView("overview"); setFilter(""); setDomainPage(0); setExitSearch(""); setStateFilter("all"); setNotice(null); }
  async function refresh() {
    const pid = planId; setRefreshing(true);
    try { const result = await api(`/api/plans/${pid}/refresh`, { method: "POST" }); if (selection.current === pid) { setHealth(result.data); setPreview(null); notify("订阅已刷新。"); } }
    catch (error) { notify(error.message, true); }
    finally { setRefreshing(false); }
  }
  async function operate(action) {
    const pid = planId, id = exitId; setWorking(true);
    try {
      const result = await api(`/api/plans/${pid}/exits/${id}/${action}`, { method: "POST" });
      if (selection.current === pid) { setStatuses(current => ({ ...current, [id]: result.data })); notify(action === "stop" ? "守护已停止。" : "守护状态已更新。"); }
    } catch (error) { notify(error.message, true); }
    finally { setWorking(false); }
  }
  function openCreate(kind) { setModal(kind); setName(""); setType("ssh"); setStep(1); setDraft(null); setFormError(""); setAdvancedOpen(false); }
  function openEditor(kind) { setEditor(kind); setFormError(""); setAdvancedOpen(false); setDraft(kind === "domains" ? exit.domains.join("\n") : kind === "source" ? { ...clone(plan), isDefault: doc.defaultPlanId === planId } : clone(exit)); }
  function connectionFields(item, change, disabled = false) {
    const tunnel = (key, value) => change({ ...item, tunnel: { ...item.tunnel, [key]: value }, ...(key === "socksPort" ? { port: value } : {}) });
    return <div className="form-grid"><Field label="出口名称"><Input required maxLength={80} value={item.name} disabled={disabled} onChange={e => change({ ...item, name: e.target.value })} /></Field>{item.type === "ssh" ? <><Field label="中转服务器"><Input required disabled={disabled} value={item.tunnel.relayHost} onChange={e => tunnel("relayHost", e.target.value)} /></Field><Field label="SSH 私钥路径" wide><Input required disabled={disabled} value={item.tunnel.keyFile} onChange={e => tunnel("keyFile", e.target.value)} /></Field>{[["本地 SOCKS5 端口", "socksPort"], ["中转 SSH 用户", "relayUser"], ["目标 SSH 用户", "companyUser"]].map(([label, key]) => <Field label={label} key={key}><Input required disabled={disabled} type={key.toLowerCase().includes("port") ? "number" : "text"} min={1} max={65535} value={item.tunnel[key]} onChange={e => tunnel(key, key.toLowerCase().includes("port") ? Number(e.target.value) : e.target.value)} /></Field>)}<details className="ssh-advanced wide" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}><summary>高级 SSH 参数</summary><div className="form-grid">{[["中转 SSH 端口", "relaySshPort"], ["本地中转端口", "relayPort"], ["远端转发端口", "remotePort"]].map(([label, key]) => <Field label={label} key={key}><Input required onInvalid={() => setAdvancedOpen(true)} disabled={disabled} type="number" min={1} max={65535} value={item.tunnel[key]} onChange={e => tunnel(key, Number(e.target.value))} /></Field>)}</div></details></> : <><Field label="服务器地址"><Input required value={item.server} onChange={e => change({ ...item, server: e.target.value })} /></Field><Field label="端口"><Input required type="number" min={1} max={65535} value={item.port} onChange={e => change({ ...item, port: Number(e.target.value) })} /></Field><Field label="用户名"><Input autoComplete="off" value={item.username || ""} onChange={e => change({ ...item, username: e.target.value })} /></Field><Field label="密码"><Input type="password" autoComplete="off" value={item.password || ""} onChange={e => change({ ...item, password: e.target.value })} /></Field></>}</div>;
  }
  function validateConnection(item) {
    const host = item.type === "ssh" ? item.tunnel.relayHost : item.server;
    if (!item.name.trim() || !host.trim() || /[\s/@?#]/.test(host)) return "请填写有效名称和服务器地址。";
    const ports = item.type === "ssh" ? [item.tunnel.relayPort, item.tunnel.socksPort, item.tunnel.relaySshPort, item.tunnel.remotePort] : [item.port];
    if (ports.some(value => !Number.isInteger(value) || value < 1 || value > 65535)) { setAdvancedOpen(true); return "端口应为 1–65535 的整数。"; }
    if (item.type === "ssh") {
      if (!item.tunnel.keyFile.trim() || !item.tunnel.relayUser.trim() || !item.tunnel.companyUser.trim()) return "请填写 SSH 用户和私钥路径。";
      const used = doc.plans.flatMap(p => p.exits.filter(e => e.id !== item.id && e.enabled && e.type === "ssh").flatMap(e => [e.tunnel.relayPort, e.tunnel.socksPort]));
      if (item.enabled && (item.tunnel.relayPort === item.tunnel.socksPort || [item.tunnel.relayPort, item.tunnel.socksPort].some(p => used.includes(p)))) { setAdvancedOpen(true); return "本地端口与其他启用出口冲突，请更换端口。"; }
    }
    return "";
  }
  function confirmEditor(event) {
    event.preventDefault();
    if (editor === "domains") {
      try {
        const entries = [...new Set(draft.split(/[\s,，;；]+/).filter(Boolean).map(value => {
          let value2 = value.toLowerCase().replace(/^\*?\./, "");
          if (/[/:?#@]/.test(value2)) throw Error();
          value2 = new URL(`http://${value2}`).hostname;
          if (!value2.includes(".") || value2.length > 253 || !value2.split(".").every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) throw Error();
          return value2;
        }))];
        if (entries.length > 500) throw Error();
        const conflict = exit.enabled && plan.exits.find(e => e.id !== exit.id && e.enabled && entries.some(d => e.domains.includes(d)));
        if (conflict) { setFormError(`域名已归属“${conflict.name}”，请先调整该出口。`); return; }
        updateExit({ domains: entries }); setDomainPage(0);
      } catch { setFormError("请输入有效域名，最多 500 条。每行一个，也可用空格或逗号分隔。"); return; }
    } else if (editor === "connection") { const error = validateConnection(draft); if (error) { setFormError(error); return; } updateExit(draft); }
    else if (editor === "source") { if (!draft.name.trim()) { setFormError("请填写方案名称。"); return; } if (draft.subscription.url) { try { const u = new URL(draft.subscription.url); if (!["http:", "https:"].includes(u.protocol) || u.origin === location.origin) throw Error(); } catch { setFormError("请输入有效的 HTTP/HTTPS 订阅地址，不能引用本合并服务。"); return; } } setDoc(current => ({ ...current, defaultPlanId: draft.isDefault ? planId : current.defaultPlanId, plans: current.plans.map(p => p.id === planId ? { ...p, name: draft.name.trim(), subscription: draft.subscription } : p) })); }
    setEditor(null);
  }
  function create(event) {
    event.preventDefault(); if (!name.trim()) return;
    if (modal === "plan") {
      const item = { id: uid("plan"), name: name.trim(), subscription: { ...defaults.subscription }, exits: [] };
      setDoc(current => ({ ...current, plans: [...current.plans, item] })); choosePlan(item.id); setDraft({ ...clone(item), isDefault: false }); setEditor("source");
    } else {
      if (step === 2) { const error = validateConnection(draft); if (error) { setFormError(error); return; } updatePlan({ exits: [...plan.exits, draft] }); chooseExit(draft.id); setModal(null); return; }
      const used = new Set(doc.plans.flatMap(item => item.exits.filter(item => item.type === "ssh").flatMap(item => [item.tunnel.relayPort, item.tunnel.socksPort])));
      function port(start) { while (used.has(start)) start++; used.add(start); return start; }
      const tunnel = { ...defaults.tunnel, relayPort: port(2222), socksPort: port(1080) };
      const item = { id: uid("exit"), name: name.trim(), type, enabled: true, domains: [], server: "127.0.0.1", port: type === "ssh" ? tunnel.socksPort : 1080, ...(type === "ssh" ? { tunnel } : {}) };
      setDraft(item); setStep(2); return;
    }
    setModal(null);
  }
  function remove() {
    if (deleting === "plan") {
      const plans = doc.plans.filter(item => item.id !== planId), next = plans[0];
      setDoc({ ...doc, plans, defaultPlanId: doc.defaultPlanId === planId ? next.id : doc.defaultPlanId }); choosePlan(next.id);
    } else { updatePlan({ exits: plan.exits.filter(item => item.id !== exitId) }); setView("overview"); setExitId(""); }
    setDeleting(null);
  }
  function reorder(index, step) { const exits = [...plan.exits]; [exits[index], exits[index + step]] = [exits[index + step], exits[index]]; updatePlan({ exits }); }
  function addDomains(event) {
    event.preventDefault();
    try {
      const entries = domains.split(/[\s,，;；]+/).filter(Boolean).map(value => {
        let domain = value.toLowerCase().replace(/^\*?\./, "");
        if (/[\s/:?#@,]/.test(domain)) throw Error();
        domain = new URL(`http://${domain}`).hostname;
        if (!domain.includes(".") || domain.length > 253 || !domain.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) throw Error();
        return domain;
      });
      const conflict = plan.exits.find(item => item.id !== exitId && item.enabled && entries.some(domain => item.domains.includes(domain)));
      if (conflict) { notify(`域名已分配给“${conflict.name}”。`, true); return; }
      const next = [...new Set([...exit.domains, ...entries])]; if (next.length > 500) throw Error();
      updateExit({ domains: next }); setDomains(""); setNotice(null);
    } catch { notify("请输入有效域名，最多 500 条。", true); }
  }
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { notify("无法复制订阅地址。", true); } }
  async function getPreview() {
    const pid = planId; setPreviewBusy(true);
    try { const result = await api(`/api/plans/${pid}/preview`); if (selection.current === pid) setPreview(result.data); }
    catch (error) { notify(error.message, true); }
    finally { setPreviewBusy(false); }
  }
  function download() { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([preview.yaml], { type: "application/yaml" })); link.download = `${plan.id}.yaml`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  if (!doc || !plan) return <div className="loading"><Layers3 size={32} /><h1>Clash Merge</h1><p>{loadingError || "正在读取配置…"}</p>{loadingError && <Button onClick={load}>重新加载</Button>}</div>;
  const enabled = plan.exits.filter(item => item.enabled);
  const count = enabled.reduce((total, item) => total + item.domains.length, 0);
  const managed = Object.values(statuses).some(item => item.managed || item.busy);
  const locked = status?.managed || status?.busy || working;
  const occupied = status?.socksListening || status?.relayListening;
  const startReason = dirty ? "保存配置后可启动守护" : occupied && !status?.managed ? "端口由外部进程使用" : !exit?.enabled ? "出口已停用" : !status ? "正在读取守护状态" : "";
  const title = view === "exit" ? exit?.name : view === "source" ? "默认订阅" : view === "output" ? "方案订阅" : plan.name;
  const matchingDomains = exit?.domains.filter(d => d.includes(filter.toLowerCase())) || [];
  const visibleExits = plan.exits.filter(e => (!exitSearch || `${e.name} ${e.domains.join(" ")}`.toLowerCase().includes(exitSearch.toLowerCase())) && (stateFilter === "all" || stateFilter === "enabled" && e.enabled || stateFilter === "disabled" && !e.enabled));
  const external = exit?.type === "ssh" && occupied && !status?.managed;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><Layers3 size={23} /><strong>Clash Merge</strong></a>
      <div className="sidebar-label"><span>方案</span><Tool label="新建方案" onClick={() => openCreate("plan")}><Plus size={18} /></Tool></div>
      <nav aria-label="方案列表">{doc.plans.map(item => <button key={item.id} className={`plan-link ${item.id === planId ? "selected" : ""}`} onClick={() => choosePlan(item.id)}><Layers3 size={17} /><span>{item.name}</span>{item.id === doc.defaultPlanId && <span className="default-mark">默认</span>}</button>)}</nav>
      <div className="sidebar-footer"><ShieldCheck size={15} /><span>本地工作台</span><span className="dot" /></div>
    </aside>
    <div className="workspace">
      <header className="toolbar"><div className="trail"><span className="mobile-brand">Clash Merge</span><Choice label="当前方案" value={planId} onChange={choosePlan} options={doc.plans.map(p => [p.id, p.name])} /><span className="mobile-create"><Tool label="新建方案" disabled={doc.plans.length >= 20} onClick={() => openCreate("plan")}><Plus size={17} /></Tool></span></div><div className="toolbar-actions"><AgentAccess /><span className={dirty ? "edit-state dirty" : "edit-state"}>{dirty ? "有未保存更改" : "配置已保存"}</span>{dirty && <Button variant="ghost" size="sm" onClick={undo}>取消更改</Button>}<Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "保存中…" : dirty ? "保存配置" : "已保存"}</Button></div></header>
      <main>
        {notice && <div className={`notice ${notice.error ? "error" : ""}`} role="status"><AlertCircle size={18} /><span>{notice.text}</span><Tool label="关闭通知" onClick={() => setNotice(null)}><X size={16} /></Tool></div>}
        <div className="page-heading"><div>{view !== "overview" && <button className="back-link" onClick={() => setView("overview")}><ArrowLeft size={15} />方案总览</button>}<h1>{title}</h1>{view === "overview" && <p className="heading-description">默认订阅与出口扩展</p>}</div>{view === "overview" && <Button onClick={() => openCreate("exit")} disabled={plan.exits.length >= 30}><Plus size={16} />添加出口</Button>}</div>
        {view === "overview" && <>
          <section className="plan-summary"><div><span className="overline">默认订阅</span><strong>{plan.subscription.url ? "自定义订阅" : plan.subscription.profileName}</strong><button className="text-action" onClick={() => openEditor("source")}>编辑来源</button><p><State value={health?.status === "ok" ? [health.stale ? "使用备用配置" : "已更新", health.stale ? "amber" : "green"] : [persisted ? "等待订阅" : "尚未保存", "neutral"]} />{health?.lastRefreshAt && <span> · {new Date(health.lastRefreshAt).toLocaleTimeString("zh-CN")}</span>}</p></div><div><span className="overline">出口扩展</span><strong>{enabled.length} 个启用 / {plan.exits.length} 个出口</strong><p>{plan.exits.length ? [...new Set(plan.exits.map(e => TYPES[e.type]))].join(" · ") : "暂无扩展出口"}</p></div><div><span className="overline">路由范围</span><strong>{count} 个域名</strong><p>其余流量遵循默认订阅</p></div></section>
          {persisted && health && (health.status !== "ok" || health.stale) && <div className="issue"><AlertCircle size={17} /><div><strong>默认订阅需要处理</strong><span>{health.stale ? "正在使用备用配置，请检查订阅来源。" : "订阅获取失败，请检查地址或刷新重试。"}</span></div><Button variant="ghost" size="sm" disabled={dirty || refreshing} onClick={refresh}>刷新订阅</Button></div>}
          <div className="section-heading bench-heading"><h2>出口</h2><span>按优先级排序</span></div>
          <section className="workbench"><div className="exit-list">{plan.exits.length > 8 && <div className="exit-filters"><Input aria-label="搜索出口或域名" placeholder="搜索出口或域名" value={exitSearch} onChange={e => setExitSearch(e.target.value)} /><Choice label="出口状态筛选" value={stateFilter} onChange={setStateFilter} options={[["all", "全部出口"], ["enabled", "启用"], ["disabled", "停用"]]} /></div>}<div className="exit-list-scroll">{visibleExits.map(item => <button key={item.id} className={`exit-item ${item.id === exitId ? "selected" : ""}`} onClick={() => chooseExit(item.id)}><div><strong>{item.name}</strong><span>{String(plan.exits.indexOf(item) + 1).padStart(2, "0")}</span></div><p>{TYPES[item.type]} · {item.server}:{item.port}</p><State value={exitState(item, statuses[item.id])} /><small>{item.domains.length} 个域名</small></button>)}{!!plan.exits.length && !visibleExits.length && <div className="empty compact">没有匹配的出口</div>}</div></div><div className="inspector">{exit ? <><div className="inspect-heading"><div><h2>{exit.name}</h2><p>{TYPES[exit.type]} · {exit.server}:{exit.port}</p></div><div className="button-group"><State value={exitState(exit, status)} />{exit.type === "ssh" && <Button variant="outline" size="sm" disabled={working || (status?.managed ? false : !!startReason || !persisted || locked)} onClick={() => operate(status?.managed ? "stop" : "start")}>{status?.managed ? "停止" : "启动"}</Button>}</div></div>
          {external && <div className="issue"><AlertCircle size={16} /><div><strong>端口由外部进程使用</strong><span>守护操作不可用，现有连接保持运行。</span></div><button className="text-action" onClick={() => openEditor("diagnose")}>查看详情</button></div>}
          {status?.state === "error" && <div className="issue"><AlertCircle size={16} /><div><strong>守护需要处理</strong><span>检查日志；停止守护后修改连接配置。</span></div><button className="text-action" onClick={() => openEditor("logs")}>查看日志</button></div>}
          <div className="runtime-grid"><div><span>端口状态</span><strong>{!status ? persisted ? "检查中" : "尚未保存" : status.socksListening || status.listening ? "已监听" : "未监听"}</strong></div><div><span>守护归属</span><strong>{exit.type !== "ssh" ? "外部代理服务" : status?.managed ? "本服务管理" : external ? "外部进程" : "未启动"}</strong></div><div><span>实际连通性</span><strong className="unverified">未验证</strong></div></div>
          <div className="domain-heading"><h3>域名路由 <span>{exit.domains.length}</span></h3><button className="text-action" onClick={() => openEditor("domains")}>编辑域名</button></div>{exit.domains.length > 20 && <Input className="domain-search" aria-label="筛选域名" placeholder="搜索域名" value={filter} onChange={e => { setFilter(e.target.value); setDomainPage(0); }} />}<div className="domain-rows">{matchingDomains.slice(domainPage * 20, domainPage * 20 + 20).map(d => <div className="domain-line" key={d}><code>{d}</code><span>包含子域名</span></div>)}{!matchingDomains.length && <div className="empty compact">{exit.domains.length ? "没有匹配的域名" : "暂无域名"}</div>}</div>{matchingDomains.length > 20 && <div className="pagination"><span>{matchingDomains.length} 条 · 第 {domainPage + 1} / {Math.ceil(matchingDomains.length / 20)} 页</span><Tool label="上一页" disabled={!domainPage} onClick={() => setDomainPage(domainPage - 1)}><ArrowLeft size={16} /></Tool><Tool label="下一页" disabled={(domainPage + 1) * 20 >= matchingDomains.length} onClick={() => setDomainPage(domainPage + 1)}><ChevronRight size={16} /></Tool></div>}
          <div className="detail-actions"><button onClick={() => openEditor("connection")}>连接配置</button><button disabled={external || exit.type !== "ssh"} onClick={() => openEditor("logs")}>守护日志</button><button disabled={locked} title={locked ? "请先停止守护" : ""} onClick={() => { if (!exit.enabled) { const conflict = plan.exits.find(e => e.id !== exit.id && e.enabled && e.domains.some(d => exit.domains.includes(d))); if (conflict) { notify(`域名与“${conflict.name}”冲突。`, true); return; } } updateExit({ enabled: !exit.enabled }); }}>{exit.enabled ? "停用出口" : "启用出口"}</button><button onClick={() => openEditor("priority")}>调整优先级</button><Tool label="删除出口" disabled={locked} onClick={() => setDeleting("exit")}><Trash2 size={15} /></Tool></div>{locked && <p className="lock-reason">守护运行中：请先停止，再修改连接、停用或删除出口。</p>}{dirty && exit.type === "ssh" && !status?.managed && !external && <p className="lock-reason">保存配置后才能启动守护。</p>}</> : <div className="empty"><Network size={28} /><h2>还没有出口</h2><p>当前所有流量遵循默认订阅。</p><Button variant="outline" onClick={() => openCreate("exit")}><Plus size={16} />添加第一个出口</Button></div>}</div></section>
          <section className="delivery-band"><div><h2>方案订阅</h2><code>{url}</code></div><Button variant="outline" size="sm" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "已复制" : "复制地址"}</Button><Button variant="ghost" size="sm" onClick={() => { setView("output"); if (!dirty && persisted) getPreview(); }}>查看输出</Button></section>
        </>}
        {view === "output" && <><section className="settings-section"><div className="section-heading"><h2>订阅地址</h2><span className="quiet-badge">{plan.id}</span></div><div className="url-output"><code>{url}</code><Tool label="复制方案订阅地址" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}</Tool></div>{doc.defaultPlanId === planId && <div className="alias">默认入口 <code>{location.origin}/clash.yaml</code></div>}</section><section className="settings-section"><div className="section-heading"><h2>生成配置</h2><div className="button-group"><Button variant="outline" size="sm" disabled={dirty || !persisted || previewBusy} onClick={getPreview}><RefreshCw size={16} />{previewBusy ? "读取中…" : "生成预览"}</Button><Tool label="下载配置" disabled={!preview || dirty} onClick={download}><Download size={18} /></Tool></div></div>{dirty ? <div className="empty">保存配置后可生成预览</div> : preview ? <pre className="yaml">{preview.yaml}</pre> : <div className="empty"><FileCode2 size={28} /><span>暂无预览</span></div>}</section></>}
      </main><footer className="page-footer"><ShieldCheck size={14} /><span>127.0.0.1</span><span className="footer-id">{plan.id}</span></footer>
    </div>
    <Dialog open={!!modal} onOpenChange={open => !open && setModal(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{modal === "plan" ? "新建方案" : "添加出口"}</DialogTitle><DialogDescription>{modal === "exit" ? `${step} / 2 · ${step === 1 ? "选择连接方式" : "连接配置"}` : plan.name}</DialogDescription></DialogHeader><form onSubmit={create} className="dialog-form">{step === 1 || modal === "plan" ? <><Field label={modal === "plan" ? "方案名称" : "出口名称"}><Input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></Field>{modal === "exit" && <Field label="出口类型"><Choice label="出口类型" value={type} onChange={setType} options={Object.entries(TYPES)} /></Field>}</> : draft && connectionFields(draft, setDraft)}{formError && <p className="form-error" role="alert">{formError}</p>}<DialogFooter>{step === 2 && <Button variant="ghost" type="button" onClick={() => setStep(1)}>上一步</Button>}<Button variant="outline" type="button" onClick={() => setModal(null)}>取消</Button><Button type="submit" disabled={!name.trim()}>{modal === "plan" ? "创建方案" : step === 1 ? "继续" : "添加出口"}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!editor} onOpenChange={open => !open && setEditor(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{{ domains: "编辑域名", connection: "连接配置", source: "默认订阅", logs: "守护日志", priority: "调整优先级", diagnose: "外部进程" }[editor]}</DialogTitle><DialogDescription>{editor === "source" ? plan.name : exit?.name}</DialogDescription></DialogHeader><form onSubmit={confirmEditor} className="dialog-form">
      {editor === "domains" && <><Field label="域名"><Textarea aria-label="域名" rows={10} spellCheck={false} value={draft || ""} onChange={e => setDraft(e.target.value)} /></Field><p className="muted">每行一个域名，包含其子域名。相同域名只能归属一个启用出口。</p></>}
      {editor === "connection" && draft && <>{locked && <div className="issue">请先停止守护，再修改连接配置。</div>}{connectionFields(draft, setDraft, locked)}</>}
      {editor === "source" && draft && <><Field label="方案名称"><Input required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field><div className="switch-row"><span>默认方案 <small>/clash.yaml</small></span><Switch aria-label="设为默认方案" checked={draft.isDefault} disabled={doc.defaultPlanId === planId} onCheckedChange={isDefault => setDraft({ ...draft, isDefault })} /></div><Field label="Clash 订阅"><Choice label="Clash 订阅" value={draft.subscription.profileName} onChange={profileName => setDraft({ ...draft, subscription: { ...draft.subscription, profileName } })} options={[...new Set([draft.subscription.profileName, ...profiles.filter(p => p.type === "remote").map(p => p.name)])].map(n => [n, n])} /></Field><Field label="自定义订阅 URL"><div className="secret-field"><Input aria-label="自定义订阅 URL" type={showUrl ? "text" : "password"} autoComplete="off" placeholder="留空使用 Clash 订阅" value={draft.subscription.url} onChange={e => setDraft({ ...draft, subscription: { ...draft.subscription, url: e.target.value } })} /><Tool label={showUrl ? "隐藏订阅地址" : "显示订阅地址"} onClick={() => setShowUrl(!showUrl)}>{showUrl ? <EyeOff size={17} /> : <Eye size={17} />}</Tool></div></Field><Field label="User-Agent"><Input value={draft.subscription.userAgent} onChange={e => setDraft({ ...draft, subscription: { ...draft.subscription, userAgent: e.target.value } })} /></Field><div className="button-group"><Button variant="outline" type="button" disabled={dirty || !persisted || refreshing} onClick={refresh}><RefreshCw size={16} />刷新已保存订阅</Button><Tool label="删除方案" disabled={doc.plans.length === 1 || managed} onClick={() => { setEditor(null); setDeleting("plan"); }}><Trash2 size={16} /></Tool></div></>}
      {editor === "logs" && <><div className="logs">{status?.logs?.length ? status.logs.map((l, i) => <div key={i}><time>{new Date(l.time).toLocaleTimeString("zh-CN")}</time><span>{l.message}</span></div>) : <div className="empty compact">暂无守护日志</div>}</div>{status?.managed && <Button type="button" variant="outline" disabled={dirty || working} onClick={() => operate("restart")}><RefreshCw size={16} />重新连接</Button>}</>}
      {editor === "diagnose" && <><div className="issue"><div><strong>外部进程诊断</strong><p>以下为本服务观察到的端口状态。SSH 原始输出请在启动脚本的终端查看；监听状态不代表目标网络可达。</p></div></div><div className="logs">{status?.listenerInfo?.map(info => <div key={info.port}><span>{info.role} · {info.port}</span><span>{info.processes?.length ? info.processes.map(p => `${p.name} · PID ${p.pid}`).join("；") : info.error || "未找到监听进程"}</span></div>)}</div><div className="logs">{status?.diagnosticLogs?.length ? status.diagnosticLogs.map((l, i) => <div key={i}><time>{new Date(l.time).toLocaleTimeString("zh-CN")}</time><span>{l.message}</span></div>) : <div className="empty compact">暂无诊断记录</div>}</div></>}
      {editor === "priority" && <div className="priority-list">{plan.exits.map((e, i) => <div key={e.id}><span>{i + 1}. {e.name}</span><Tool label={`上移 ${e.name}`} disabled={!i} onClick={() => reorder(i, -1)}><ArrowUp size={15} /></Tool><Tool label={`下移 ${e.name}`} disabled={i === plan.exits.length - 1} onClick={() => reorder(i, 1)}><ArrowDown size={15} /></Tool></div>)}<p className="muted">重叠后缀按完整列表顺序匹配，调整将写入草稿。</p></div>}
      {formError && <p className="form-error" role="alert">{formError}</p>}<DialogFooter><Button variant="outline" type="button" onClick={() => setEditor(null)}>{["logs", "priority", "diagnose"].includes(editor) ? "完成" : "取消"}</Button>{["domains", "source", "connection"].includes(editor) && <Button type="submit" disabled={editor === "connection" && locked}>确认更改</Button>}</DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}><DialogContent><DialogHeader><DialogTitle>删除{deleting === "plan" ? "方案" : "出口"}？</DialogTitle><DialogDescription>{deleting === "plan" ? plan.name : exit?.name} · {deleting === "plan" ? count : exit?.domains.length} 条域名规则将移除，保存后客户端更新订阅才采用更改。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" onClick={remove}>删除</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
createRoot(document.getElementById("root")).render(<TooltipProvider delayDuration={200}><App /></TooltipProvider>);
