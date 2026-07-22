import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  { path: "/login", component: () => import("../views/Login.vue"), meta: { public: true } },
  {
    path: "/",
    component: () => import("../views/Shell.vue"),
    redirect: "/dashboard",
    children: [
      { path: "dashboard", component: () => import("../views/Dashboard.vue"), meta: { title: "驾驶舱" } },
      { path: "procurement", component: () => import("../views/Procurement.vue"), meta: { title: "采购计划" } },
      { path: "bottles", component: () => import("../views/Bottles.vue"), meta: { title: "暂存台账" } },
      { path: "scan", component: () => import("../views/Scan.vue"), meta: { title: "扫码核验" } },
      { path: "requisitions", component: () => import("../views/Requisitions.vue"), meta: { title: "领用审批" } },
      { path: "dual-verify", component: () => import("../views/DualVerify.vue"), meta: { title: "双人核验" } },
      { path: "usage", component: () => import("../views/Usage.vue"), meta: { title: "使用登记" } },
      { path: "waste", component: () => import("../views/Waste.vue"), meta: { title: "废液归集" } },
      { path: "empty-bottles", component: () => import("../views/EmptyBottles.vue"), meta: { title: "空瓶回收" } },
      { path: "reports", component: () => import("../views/Reports.vue"), meta: { title: "统计报表" } },
      { path: "audit", component: () => import("../views/Audit.vue"), meta: { title: "审计追溯" } },
      { path: "compliance", component: () => import("../views/Compliance.vue"), meta: { title: "合规对接" } },
    ],
  },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem("token");
  if (to.meta.public) return next();
  if (!token) return next("/login");
  next();
});

export default router;
