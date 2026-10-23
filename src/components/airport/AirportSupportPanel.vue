<template>
  <section class="airport-support-panel" aria-labelledby="airport-support-heading">
    <h2 id="airport-support-heading">保障状态</h2>
    <dl class="airport-support-details">
      <div>
        <dt><span class="airport-state-dot aircraft-state" aria-hidden="true" />飞机</dt>
        <dd>停靠预置</dd>
      </div>
      <div>
        <dt><span class="airport-state-dot bridge-state" aria-hidden="true" />发动机</dt>
        <dd>关闭预置</dd>
      </div>
      <div>
        <dt><span class="airport-state-dot vehicle-state" aria-hidden="true" />轮挡</dt>
        <dd>预置到位</dd>
      </div>
    </dl>
    <p class="airport-support-note">V0.2 业务仿真 · 非现场实时数据</p>
  </section>
</template>

<style scoped>
.airport-support-panel {
  width: 280px;
  padding: 21px 22px 18px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 6px 24px rgba(32, 55, 80, 0.07);
}
.airport-support-panel h2 {
  margin: 0;
  padding: 0 0 16px;
  border-bottom: 1px solid rgba(35, 65, 99, 0.08);
  color: #152b4a;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
}
.airport-support-details {
  display: grid;
  gap: 18px;
  margin: 18px 0 20px;
  font-size: 14px;
  line-height: 1.5;
}
.airport-support-details > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
}
.airport-support-details dt {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #52657e;
  font-weight: 400;
}
.airport-support-details dd {
  margin: 0;
  color: #405671;
  font-weight: 500;
  text-align: right;
}
.airport-state-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.aircraft-state {
  background: #6b93b6;
  box-shadow: 0 0 0 3px #6b93b610;
}
.bridge-state {
  background: #6c9fa5;
  box-shadow: 0 0 0 3px #6c9fa510;
}
.vehicle-state {
  background: #bc9a5f;
  box-shadow: 0 0 0 3px #bc9a5f10;
}
.airport-support-note {
  margin: 0;
  padding-top: 15px;
  border-top: 1px solid rgba(35, 65, 99, 0.08);
  color: #7c899a;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}
@media (max-width: 1480px) {
  .airport-support-panel {
    width: 254px;
    padding: 19px 20px 17px;
  }
  .airport-support-details {
    gap: 15px;
  }
}
@media (max-width: 700px) {
  .airport-support-panel {
    width: 208px;
    padding: 15px;
  }
  .airport-support-note {
    font-size: 11px;
  }
  .airport-support-details dt {
    gap: 9px;
  }
}
</style>
