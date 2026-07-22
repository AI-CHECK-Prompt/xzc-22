<template>
  <div class="page">
    <div class="kpi-grid">
      <div class="kpi"><div class="label">试剂瓶总数</div><div class="value">{{ data.bottles || 0 }}</div><div class="delta">含在库 / 在用 / 待回收</div></div>
      <div class="kpi warn"><div class="label">高危品类</div><div class="value">{{ data.highRisk || 0 }}</div><div class="delta">易制毒 + 易制爆 + 剧毒</div></div>
      <div class="kpi danger"><div class="label">低库存告警</div><div class="value">{{ data.lowAlerts || 0 }}</div><div class="delta">剩余量低于 10% 初始量</div></div>
      <div class="kpi"><div class="label">审计事件</div><div class="value">{{ data.audits || 0 }}</div><div class="delta">不可变流水</div></div>
    </div>

    <div class="row-2">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>采购金额趋势</h3>
        <v-chart :option="amountOpt" autoresize style="height:280px;" />
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>领用频次 TOP10</h3>
        <v-chart :option="freqOpt" autoresize style="height:280px;" />
      </div>
    </div>

    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>废液分类统计</h3>
        <v-chart :option="wasteOpt" autoresize style="height:260px;" />
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>库存周转率</h3>
        <v-chart :option="turnOpt" autoresize style="height:260px;" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { http } from "../utils/http";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { TooltipComponent, GridComponent, LegendComponent, TitleComponent } from "echarts/components";
import VChart from "vue-echarts";

use([CanvasRenderer, BarChart, LineChart, PieChart, TooltipComponent, GridComponent, LegendComponent, TitleComponent]);

const data = ref<any>({});
const amount = ref<any[]>([]);
const freq = ref<any[]>([]);
const waste = ref<any>({ byHandoff: {}, byBucket: [] });
const turn = ref<any[]>([]);

onMounted(async () => {
  const [d, a, f, w, t] = await Promise.all([
    http.get("/reports/dashboard"),
    http.get("/reports/procurement-amount"),
    http.get("/reports/usage-frequency"),
    http.get("/reports/waste-stat"),
    http.get("/reports/inventory-turnover"),
  ]);
  data.value = (d as any).data;
  amount.value = (a as any).data;
  freq.value = (f as any).data;
  waste.value = (w as any).data;
  turn.value = (t as any).data;
});

const amountOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { top: 24, left: 32, right: 16, bottom: 24 },
  xAxis: { type: "category", data: amount.value.map((x) => x.month), axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" } },
  yAxis: { type: "value", axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
  series: [{
    type: "line", smooth: true, data: amount.value.map((x) => x.amount),
    areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(0,210,255,0.5)" }, { offset: 1, color: "rgba(58,123,213,0.05)" }] } },
    itemStyle: { color: "#00d2ff" },
    lineStyle: { width: 2 },
  }],
}));

const freqOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { top: 16, left: 8, right: 16, bottom: 24 },
  xAxis: { type: "value", axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
  yAxis: { type: "category", data: freq.value.slice(0, 10).map((x) => x.name).reverse(), axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4" } },
  series: [{ type: "bar", data: freq.value.slice(0, 10).map((x) => x.count).reverse(), itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: "#3a7bd5" }, { offset: 1, color: "#00d2ff" }] }, borderRadius: [0, 4, 4, 0] } }],
}));

const wasteOpt = computed(() => {
  const cats = ["ORGANIC", "HEAVY_METAL", "ACID", "ALKALI", "OXIDIZER"];
  const labelMap: any = { ORGANIC: "有机废液", HEAVY_METAL: "重金属", ACID: "酸性", ALKALI: "碱性", OXIDIZER: "氧化性" };
  const byH = waste.value.byHandoff || {};
  return {
    tooltip: { trigger: "item" },
    legend: { textStyle: { color: "#b6c2d4" }, bottom: 0 },
    series: [{
      type: "pie", radius: ["40%", "70%"], center: ["50%", "45%"],
      data: cats.map((c) => ({ name: labelMap[c], value: byH[c] || 0 })),
      label: { color: "#b6c2d4" },
      itemStyle: { borderColor: "#0a1428", borderWidth: 2 },
    }],
  };
});

const turnOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { top: 16, left: 8, right: 16, bottom: 32 },
  xAxis: { type: "category", data: turn.value.map((x) => x.name), axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4", rotate: 30 } },
  yAxis: { type: "value", min: 0, max: 1, axisLine: { lineStyle: { color: "#3a4860" } }, axisLabel: { color: "#b6c2d4", formatter: "{value}" }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
  series: [{ type: "bar", data: turn.value.map((x) => x.turnover), itemStyle: { color: "#6ed6a3", borderRadius: [4, 4, 0, 0] } }],
}));
</script>
