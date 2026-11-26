// 추천물건 리포트 — 캡처 이미지 다듬기 (자르기 / 모자이크)
// recommend/core.js 다음에 불러옴. 공통 기능은 RecCore에서 받음.
(function(){
const R=window.RecCore;
const {st,recApi,reload,select,save}=R;

/* ── 캡처 이미지 다듬기 (자르기 / 모자이크) ── */
const mk={canvas:null,ctx:null,undo:[],mode:'blur',sel:null,drag:null,scale:1};
function openMask(file,replace){
  mk.replace=replace||null;
  if(!replace&&(st.cur.images||[]).length>=6){alert('이미지는 최대 6장까지 첨부할 수 있습니다.');return;}
  const img=new Image();
  img.onload=()=>{
    const MAXW=1600;const k=Math.min(1,MAXW/img.width);
    const c=document.getElementById('maskCanvas');
    c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
    mk.canvas=c;mk.ctx=c.getContext('2d');mk.ctx.drawImage(img,0,0,c.width,c.height);
    mk.undo=[];mk.sel=null;
    document.getElementById('maskCaption').value=replace?replace.caption||'':'';
    document.getElementById('maskModal').classList.add('show');
    fitMask();maskMode(replace?'blur':'crop');
    URL.revokeObjectURL(img.src);
  };
  img.src=URL.createObjectURL(file);
}
function fitMask(){
  const wrapW=document.getElementById('maskWrap').clientWidth-2;
  mk.scale=Math.min(1,wrapW/mk.canvas.width);
  mk.canvas.style.width=(mk.canvas.width*mk.scale)+'px';
  mk.canvas.style.height=(mk.canvas.height*mk.scale)+'px';
  document.getElementById('maskSel').style.display='none';
}
function maskMode(m){
  mk.mode=m;mk.sel=null;
  document.getElementById('mtCrop').classList.toggle('on',m==='crop');
  document.getElementById('mtBlur').classList.toggle('on',m==='blur');
  document.getElementById('mtCropApply').style.display='none';
  document.getElementById('maskSel').style.display='none';
}
function pushUndo(){mk.undo.push({w:mk.canvas.width,h:mk.canvas.height,data:mk.ctx.getImageData(0,0,mk.canvas.width,mk.canvas.height)});if(mk.undo.length>20)mk.undo.shift();}
function maskUndo(){
  const u=mk.undo.pop();if(!u)return;
  mk.canvas.width=u.w;mk.canvas.height=u.h;mk.ctx.putImageData(u.data,0,0);fitMask();
}
function pixelate(x,y,w,h){
  if(w<2||h<2) return;
  pushUndo();
  const block=Math.max(8,Math.min(14,Math.round(Math.min(w,h)/3)));
  const data=mk.ctx.getImageData(x,y,w,h);
  for(let by=0;by<h;by+=block)for(let bx=0;bx<w;bx+=block){
    let r=0,g=0,b=0,n=0;
    for(let yy=by;yy<Math.min(by+block,h);yy++)for(let xx=bx;xx<Math.min(bx+block,w);xx++){const i=(yy*w+xx)*4;r+=data.data[i];g+=data.data[i+1];b+=data.data[i+2];n++;}
    mk.ctx.fillStyle=`rgb(${r/n|0},${g/n|0},${b/n|0})`;
    mk.ctx.fillRect(x+bx,y+by,Math.min(block,w-bx),Math.min(block,h-by));
  }
}
function maskCropApply(){
  const s=mk.sel;if(!s||s.w<10||s.h<10)return;
  pushUndo();
  const data=mk.ctx.getImageData(s.x,s.y,s.w,s.h);
  mk.canvas.width=s.w;mk.canvas.height=s.h;mk.ctx.putImageData(data,0,0);
  fitMask();maskMode('blur');
}
function bindMask(){
  const c=document.getElementById('maskCanvas'),sel=document.getElementById('maskSel');
  const pos=e=>{const b=c.getBoundingClientRect();return{x:Math.max(0,Math.min(mk.canvas.width,(e.clientX-b.left)/mk.scale)),y:Math.max(0,Math.min(mk.canvas.height,(e.clientY-b.top)/mk.scale))};};
  c.addEventListener('mousedown',e=>{mk.drag=pos(e);e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(!mk.drag) return;
    const p=pos(e);
    const x=Math.min(p.x,mk.drag.x),y=Math.min(p.y,mk.drag.y),w=Math.abs(p.x-mk.drag.x),h=Math.abs(p.y-mk.drag.y);
    mk.sel={x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h)};
    Object.assign(sel.style,{display:'block',left:(c.offsetLeft+x*mk.scale)+'px',top:(c.offsetTop+y*mk.scale)+'px',width:(w*mk.scale)+'px',height:(h*mk.scale)+'px'});
  });
  window.addEventListener('mouseup',()=>{
    if(!mk.drag) return;
    mk.drag=null;
    if(!mk.sel) return;
    if(mk.mode==='blur'){const s=mk.sel;pixelate(s.x,s.y,s.w,s.h);mk.sel=null;sel.style.display='none';}
    else document.getElementById('mtCropApply').style.display='';
  });
}
async function maskDone(){
  const dataUrl=mk.canvas.toDataURL('image/jpeg',0.88);
  const caption=document.getElementById('maskCaption').value;
  try{
    if(st.dirty) await save(true);
    const rep=mk.replace; mk.replace=null;
    let rec=await recApi(`/api/recommendations/${st.cur.id}/images`,'POST',{dataUrl,caption,source:rep?rep.source:'manual'});
    if(rep){
      // 다듬은 이미지를 원래 자리로 옮기고 원본 삭제
      const newer=rec.images[rec.images.length-1];
      const order=rec.images.filter(i=>i.file!==newer.file&&i.file!==rep.file);
      order.splice(Math.min(rep.index,order.length),0,newer);
      await recApi(`/api/recommendations/${st.cur.id}`,'PUT',{images:[...order,...rec.images.filter(i=>i.file===rep.file)]});
      await recApi(`/api/recommendations/${st.cur.id}/images/${encodeURIComponent(rep.file)}`,'DELETE');
    }
    document.getElementById('maskModal').classList.remove('show');
    await reload(st.cur.id);select(st.cur.id);
  }catch(e){alert('이미지 업로드 오류: '+e.message);}
}
function maskCancel(){mk.replace=null;document.getElementById('maskModal').classList.remove('show');}
async function imgEdit(file){
  if(st.dirty) await save(true);
  const idx=(st.cur.images||[]).findIndex(i=>i.file===file);if(idx<0)return;
  const im=st.cur.images[idx];
  const blob=await (await fetch('/api/rec-images/'+encodeURIComponent(file),{credentials:'same-origin'})).blob();
  openMask(blob,{file,index:idx,caption:im.caption,source:im.source});
}

Object.assign(R,{openMask,fitMask,bindMask});
Object.assign(window.RecReport,{imgEdit,maskMode,maskUndo,maskCropApply,maskDone,maskCancel});
})();
