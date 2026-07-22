import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElIcons from "@element-plus/icons-vue";
import App from "./App.vue";
import router from "./router";
import "./styles/main.css";

const app = createApp(App);
for (const [k, v] of Object.entries(ElIcons as any)) {
  app.component(k, v as any);
}
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount("#app");
