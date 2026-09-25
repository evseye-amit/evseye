document.querySelectorAll('#year').forEach(e=>e.textContent=new Date().getFullYear());
const m=document.querySelector('.menu'); if(m){m.addEventListener('click',()=>document.querySelector('.nav nav').classList.toggle('open'));}
