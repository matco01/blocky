import{dK as A,di as M,dc as z,de as o,fy as O,dP as E,f1 as w,f2 as C,dg as a,dG as k,dh as p,cq as q,cm as P,fz as I}from"./index-BPER27xv.js";import{h as F}from"./CopyToClipboard-i_OQSBJr-Dn5chTcj.js";import{d as $}from"./Layouts-BMRfo5hw-rvTgYBPw.js";import{a as V,i as B}from"./JsonTree-BHzNC-ic-DBnywXLU.js";import{n as H}from"./ScreenLayout-OwaQQcxH-CcVZ4wK5.js";import{c as J}from"./createLucideIcon-Dp411C20.js";import"./ModalFooter-BCuEK_nz-C-PlI8xl.js";import"./Screen-D30meWsY-BlNgqNh2.js";import"./index-CWARkn2w-D3bGtN4n.js";/**
 * @license lucide-react v0.554.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K=[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]],G=J("square-pen",K),Q=p.img`
  && {
    height: ${e=>e.size==="sm"?"65px":"140px"};
    width: ${e=>e.size==="sm"?"65px":"140px"};
    border-radius: 16px;
    margin-bottom: 12px;
  }
`;let W=e=>{if(!q(e))return e;try{let s=P(e);return s.includes("�")?e:s}catch{return e}},X=e=>{try{let s=I.decode(e),i=new TextDecoder().decode(s);return i.includes("�")?e:i}catch{return e}},Y=e=>{let{types:s,primaryType:i,...l}=e.typedData;return a.jsxs(a.Fragment,{children:[a.jsx(te,{data:l}),a.jsx(F,{text:(r=e.typedData,JSON.stringify(r,null,2)),itemName:"full payload to clipboard"})," "]});var r};const Z=({method:e,messageData:s,copy:i,iconUrl:l,isLoading:r,success:g,walletProxyIsLoading:m,errorMessage:h,isCancellable:d,onSign:c,onCancel:y,onClose:u})=>a.jsx(H,{title:i.title,subtitle:i.description,showClose:!0,onClose:u,icon:G,iconVariant:"subtle",helpText:h?a.jsx(ee,{children:h}):void 0,primaryCta:{label:i.buttonText,onClick:c,disabled:r||g||m,loading:r},secondaryCta:d?{label:"Not now",onClick:y,disabled:r||g||m}:void 0,watermark:!0,children:a.jsxs($,{children:[l?a.jsx(Q,{style:{alignSelf:"center"},size:"sm",src:l,alt:"app image"}):null,a.jsxs(N,{children:[e==="personal_sign"&&a.jsx(R,{children:W(s)}),e==="eth_signTypedData_v4"&&a.jsx(Y,{typedData:s}),e==="solana_signMessage"&&a.jsx(R,{children:X(s)})]})]})}),ue={component:()=>{let{authenticated:e}=A(),{initializeWalletProxy:s,closePrivyModal:i}=M(),{navigate:l,data:r,onUserCloseViaDialogOrKeybindRef:g}=z(),[m,h]=o.useState(!0),[d,c]=o.useState(""),[y,u]=o.useState(),[f,b]=o.useState(null),[T,S]=o.useState(!1);o.useEffect((()=>{e||l("LandingScreen")}),[e]),o.useEffect((()=>{s(O).then((n=>{h(!1),n||(c("An error has occurred, please try again."),u(new E(new w(d,C.E32603_DEFAULT_INTERNAL_ERROR.eipCode))))}))}),[]);let{method:j,data:v,confirmAndSign:_,onSuccess:D,onFailure:L,uiOptions:t}=r.signMessage,U={title:(t==null?void 0:t.title)||"Sign message",description:(t==null?void 0:t.description)||"Signing this message will not cost you any fees.",buttonText:(t==null?void 0:t.buttonText)||"Sign and continue"},x=n=>{n?D(n):L(y||new E(new w("The user rejected the request.",C.E4001_USER_REJECTED_REQUEST.eipCode))),i({shouldCallAuthOnSuccess:!1}),setTimeout((()=>{b(null),c(""),u(void 0)}),200)};return g.current=()=>{x(f)},a.jsx(Z,{method:j,messageData:v,copy:U,iconUrl:t!=null&&t.iconUrl&&typeof t.iconUrl=="string"?t.iconUrl:void 0,isLoading:T,success:f!==null,walletProxyIsLoading:m,errorMessage:d,isCancellable:t==null?void 0:t.isCancellable,onSign:async()=>{S(!0),c("");try{let n=await _();b(n),S(!1),setTimeout((()=>{x(n)}),k)}catch(n){console.error(n),c("An error has occurred, please try again."),u(new E(new w(d,C.E32603_DEFAULT_INTERNAL_ERROR.eipCode))),S(!1)}},onCancel:()=>x(null),onClose:()=>x(f)})}};let N=p.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
`,ee=p.p`
  && {
    margin: 0;
    width: 100%;
    text-align: center;
    color: var(--privy-color-error-dark);
    font-size: 14px;
    line-height: 22px;
  }
`,te=p(V)`
  margin-top: 0;
`,R=p(B)`
  margin-top: 0;
`;export{ue as SignRequestScreen,Z as SignRequestView,ue as default};
