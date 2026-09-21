/* utils/datas.js — data "de hoje" do relógio local, em ISO (aaaa-mm-dd).
   ====================================================================
   [2026-09-21, achado do usuário: "não está aparecendo os comentários do
   dia para um colega de time"] Arquivo NOVO em static/js/utils/
   (CLAUDE.md §5 — helper genérico, não pertence a nenhuma tela).

   Por que existe: a vigência dos comentários era testada contra
   `ControleCargas.SNAPSHOT.meta.today`, que é a data em que o SNAPSHOT foi
   montado — não o hoje real. Quando o "Atualizar" falha (token vencido,
   429 da API, rede fora), a tela segue pintando o snapshot.json em disco,
   cujo `meta.today` pode estar semanas atrasado. Com "hoje" congelado no
   passado, todo comentário criado hoje caía fora do intervalo
   [validFrom, validTo] e sumia da matriz, e o formulário ainda nascia com
   a data velha no campo De/Até — ou seja, o comentário nascia expirado.
   Medido na pasta do time: snapshot.json com meta.today = 2026-08-06 e os
   últimos comentários (04/09) gravados com vigência 31/08 → 02/09.

   Ler o relógio do navegador é correto aqui porque o app é local: o
   servidor Flask e a aba do navegador rodam SEMPRE na mesma máquina
   (127.0.0.1:5050, ver start.ps1), então não existe divergência de fuso
   entre os dois. Mesma fonte de verdade já usada por
   ControleCargas.formatarDataHoraAgora() (atualizar.js). */
const UtilsDatas = {

  /* Contexto:
     Data de hoje do relógio LOCAL no formato aaaa-mm-dd — o mesmo formato
     em que o backend grava validFrom/validTo (app.py::_today_str) e que o
     <input type="date"> espera no atributo `value`. Usada pela vigência
     dos comentários (comentarios.js). Retorna string.

     Não usa `toISOString()` de propósito: aquele converte para UTC e, das
     21h às 24h no horário de Brasília (UTC-3), devolveria o dia SEGUINTE.

     Pseudocódigo:
       1. Lê ano/mês/dia locais de um `new Date()`.
       2. Preenche mês e dia com zero à esquerda e junta com "-". */
  hojeISO() {
    const agora = new Date();
    const doisDigitos = (numero) => String(numero).padStart(2, '0');
    return `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
  },
};
