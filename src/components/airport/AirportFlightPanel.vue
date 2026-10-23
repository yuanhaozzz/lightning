<template>
  <section class="airport-flight-panel" aria-labelledby="airport-flight-heading">
    <h2 id="airport-flight-heading">当前航班</h2>
    <p class="airport-flight-number">DEMO-320</p>
    <dl class="airport-flight-details">
      <div>
        <dt>机位</dt>
        <dd>A21</dd>
      </div>
      <div>
        <dt>机型</dt>
        <dd>A320neo</dd>
      </div>
      <div class="airport-flight-scene">
        <dt>场景</dt>
        <dd>近机位业务仿真</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.airport-flight-panel {
  width: 280px;
  padding: 21px 22px 20px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 6px 24px rgba(32, 55, 80, 0.07);
}
.airport-flight-panel h2 {
  margin: 0;
  color: #152b4a;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
}
.airport-flight-number {
  margin: 8px 0 19px;
  color: #152b4a;
  font-size: 28px;
  line-height: 1.15;
  font-weight: 750;
  letter-spacing: -0.5px;
}
.airport-flight-details {
  display: grid;
  gap: 13px;
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
.airport-flight-details > div {
  display: grid;
  grid-template-columns: 74px 1fr;
  align-items: center;
}
.airport-flight-details dt {
  color: #65758b;
  font-weight: 400;
}
.airport-flight-details dd {
  margin: 0;
  color: #253c58;
  font-weight: 600;
}
.airport-flight-details .airport-flight-scene {
  margin-top: 2px;
  padding-top: 15px;
  border-top: 1px solid rgba(35, 65, 99, 0.08);
}
.airport-flight-scene dd {
  font-size: 13px;
  font-weight: 400;
}
@media (max-width: 1480px) {
  .airport-flight-panel {
    width: 254px;
    padding: 19px 20px;
  }
}
@media (max-width: 700px) {
  .airport-flight-panel {
    width: 214px;
    padding: 15px;
  }
  .airport-flight-number {
    font-size: 25px;
  }
  .airport-flight-details > div {
    grid-template-columns: 52px 1fr;
  }
}
</style>
