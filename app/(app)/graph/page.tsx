import { requireUser } from "@/lib/requireUser";
import { GraphView } from "@/components/graph-view";

export default async function GraphPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        节点为条目（按目录着色，大小按连接数），连线为{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">[[双向链接]]</code>
        。拖拽布局、滚轮缩放，点击节点跳转。
      </p>
      <div className="h-[70vh] min-h-[480px] rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <GraphView />
      </div>
    </div>
  );
}
