// 수강생 컨설팅 화면 — 화면 전환·자동 새로고침·시작
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
function switchView(v){
  curView=v;
  document.getElementById('cardView').style.display=v==='card'?'block':'none';
  document.getElementById('anView').style.display=v==='an'?'block':'none';
  document.getElementById('tab-card').classList.toggle('on',v==='card');
  document.getElementById('tab-an').classList.toggle('on',v==='an');
  if(v==='an') renderAnalytics();
}
function toggleForm(){const f=document.getElementById('addForm');f.style.display=f.style.display==='block'?'none':'block';}
setInterval(()=>{ if(!previewMode) loadStudents(); },60000);
initData();
