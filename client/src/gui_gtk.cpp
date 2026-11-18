// GTK3 GUI（Linux）
#include "gui.h"

#include <gtk/gtk.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "settings.h"
#include "signer.h"
#include "util.h"

namespace cs {

namespace {

GtkWidget *g_server = nullptr;
GtkWidget *g_key = nullptr;
GtkWidget *g_file = nullptr;
GtkWidget *g_algo_sha1 = nullptr;
GtkWidget *g_algo_sha256 = nullptr;
GtkWidget *g_algo_sha384 = nullptr;
GtkWidget *g_algo_sha512 = nullptr;
GtkWidget *g_timestamp = nullptr;
GtkWidget *g_backup = nullptr;
GtkWidget *g_sign = nullptr;
GtkTextBuffer *g_buffer = nullptr;
std::atomic<bool> g_busy{false};

struct LogPayload {
    std::string text;
};

gboolean append_idle(gpointer data) {
    auto *payload = static_cast<LogPayload *>(data);
    if (g_buffer) {
        GtkTextIter end;
        gtk_text_buffer_get_end_iter(g_buffer, &end);
        gtk_text_buffer_insert(g_buffer, &end, payload->text.c_str(), -1);
        gtk_text_buffer_insert(g_buffer, &end, "\n", -1);
    }
    delete payload;
    return G_SOURCE_REMOVE;
}

void append_log(const std::string &message) {
    g_idle_add(append_idle, new LogPayload{message});
}

gboolean done_idle(gpointer data) {
    const bool ok = GPOINTER_TO_INT(data) != 0;
    g_busy = false;
    if (g_sign) gtk_widget_set_sensitive(g_sign, TRUE);
    append_log(ok ? "=== 完成" : "=== 失败");
    return G_SOURCE_REMOVE;
}

void on_browse(GtkWidget *, gpointer) {
    GtkWidget *dialog = gtk_file_chooser_dialog_new(
        "选择要签名的文件", GTK_WINDOW(gtk_widget_get_toplevel(g_file)), GTK_FILE_CHOOSER_ACTION_OPEN,
        "_取消", GTK_RESPONSE_CANCEL, "_打开", GTK_RESPONSE_ACCEPT, nullptr);

    GtkFileFilter *filter = gtk_file_filter_new();
    gtk_file_filter_set_name(filter, "PE 文件 (*.exe, *.dll, *.sys)");
    gtk_file_filter_add_pattern(filter, "*.exe");
    gtk_file_filter_add_pattern(filter, "*.dll");
    gtk_file_filter_add_pattern(filter, "*.sys");
    gtk_file_filter_add_pattern(filter, "*.ocx");
    gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog), filter);

    if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
        char *name = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        if (name) {
            gtk_entry_set_text(GTK_ENTRY(g_file), name);
            g_free(name);
        }
    }
    gtk_widget_destroy(dialog);
}

struct SignJob {
    std::string server;
    std::string key;
    std::string path;
    std::vector<std::string> algorithms;
    bool timestamp = true;
    bool backup = false;
};

bool checked(GtkWidget *button) { return button && gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(button)) != 0; }

void on_sign(GtkWidget *, gpointer) {
    if (g_busy) return;

    auto job = std::make_shared<SignJob>();
    job->server = gtk_entry_get_text(GTK_ENTRY(g_server));
    job->key = gtk_entry_get_text(GTK_ENTRY(g_key));
    job->path = gtk_entry_get_text(GTK_ENTRY(g_file));
    if (checked(g_algo_sha1)) job->algorithms.push_back("sha1");
    if (checked(g_algo_sha256)) job->algorithms.push_back("sha256");
    if (checked(g_algo_sha384)) job->algorithms.push_back("sha384");
    if (checked(g_algo_sha512)) job->algorithms.push_back("sha512");
    if (job->algorithms.empty()) {
        append_log("请至少选择一种摘要算法。");
        return;
    }
    job->timestamp = checked(g_timestamp);
    job->backup = checked(g_backup);

    if (job->server.empty() || job->key.empty() || job->path.empty()) {
        append_log("请先填写 Worker 地址、API Key 和目标文件。");
        return;
    }

    Settings settings;
    settings.server = job->server;
    settings.api_key = job->key;
    settings.algorithms = job->algorithms;
    std::string save_error;
    if (!save_settings(settings, save_error)) append_log("警告：保存配置失败（" + save_error + "）");

    g_busy = true;
    gtk_widget_set_sensitive(g_sign, FALSE);
    append_log("=== 开始签名：" + file_name(job->path));

    std::thread([job]() {
        Signer signer;
        signer.options.server = job->server;
        signer.options.api_key = job->key;
        signer.options.algorithms = job->algorithms;
        signer.options.timestamp = job->timestamp;
        signer.options.backup = job->backup;
        signer.log = [](const std::string &message) { append_log(message); };

        std::string error;
        bool ok = signer.prepare(error);
        if (ok) ok = signer.sign_file(job->path, error);
        if (!ok) append_log("错误：" + error);
        g_idle_add(done_idle, GINT_TO_POINTER(ok ? 1 : 0));
    }).detach();
}

gboolean on_delete(GtkWidget *, GdkEvent *, gpointer) {
    // 签名进行中不允许关窗，避免线程往已销毁的 text buffer 里写字
    return g_busy ? TRUE : FALSE;
}

GtkWidget *add_row(GtkWidget *grid, int row, const char *label, GtkWidget *widget, int width) {
    GtkWidget *text = gtk_label_new(label);
    gtk_widget_set_halign(text, GTK_ALIGN_START);
    gtk_widget_set_size_request(widget, width, -1);
    gtk_grid_attach(GTK_GRID(grid), text, 0, row, 1, 1);
    gtk_grid_attach(GTK_GRID(grid), widget, 1, row, 1, 1);
    return widget;
}

} // namespace

bool gui_available() { return true; }

int gui_main(int argc, char **argv) {
    gtk_init(&argc, &argv);

    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "CertumSigner —— Certum 云签名");
    gtk_window_set_default_size(GTK_WINDOW(window), 780, 620);

    GtkWidget *grid = gtk_grid_new();
    gtk_grid_set_row_spacing(GTK_GRID(grid), 10);
    gtk_grid_set_column_spacing(GTK_GRID(grid), 12);
    gtk_container_set_border_width(GTK_CONTAINER(grid), 16);

    g_server = add_row(grid, 0, "服务地址", gtk_entry_new(), 520);
    g_key = add_row(grid, 1, "API Key", gtk_entry_new(), 520);
    gtk_entry_set_visibility(GTK_ENTRY(g_key), FALSE);

    GtkWidget *file_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    g_file = gtk_entry_new();
    gtk_widget_set_hexpand(g_file, TRUE);
    GtkWidget *browse = gtk_button_new_with_label("浏览…");
    gtk_box_pack_start(GTK_BOX(file_box), g_file, TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(file_box), browse, FALSE, FALSE, 0);
    add_row(grid, 2, "目标文件", file_box, 520);

    // 摘要算法可多选：每种勾选的算法各生成一个签名，默认只勾 SHA-256
    GtkWidget *algo_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
    g_algo_sha1 = gtk_check_button_new_with_label("SHA-1");
    g_algo_sha256 = gtk_check_button_new_with_label("SHA-256");
    g_algo_sha384 = gtk_check_button_new_with_label("SHA-384");
    g_algo_sha512 = gtk_check_button_new_with_label("SHA-512");
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(g_algo_sha256), TRUE);
    gtk_box_pack_start(GTK_BOX(algo_box), g_algo_sha256, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(algo_box), g_algo_sha384, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(algo_box), g_algo_sha512, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(algo_box), g_algo_sha1, FALSE, FALSE, 0);
    add_row(grid, 3, "摘要算法", algo_box, 520);

    GtkWidget *options = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 16);
    g_timestamp = gtk_check_button_new_with_label("添加时间戳");
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(g_timestamp), TRUE);
    g_backup = gtk_check_button_new_with_label("备份原文件");
    gtk_box_pack_start(GTK_BOX(options), g_timestamp, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(options), g_backup, FALSE, FALSE, 0);
    add_row(grid, 4, "选项", options, 520);

    g_sign = gtk_button_new_with_label("开始签名");
    gtk_widget_set_halign(g_sign, GTK_ALIGN_START);
    gtk_grid_attach(GTK_GRID(grid), g_sign, 1, 5, 1, 1);

    GtkWidget *scroller = gtk_scrolled_window_new(nullptr, nullptr);
    gtk_widget_set_hexpand(scroller, TRUE);
    gtk_widget_set_vexpand(scroller, TRUE);
    GtkWidget *view = gtk_text_view_new();
    gtk_text_view_set_editable(GTK_TEXT_VIEW(view), FALSE);
    gtk_text_view_set_monospace(GTK_TEXT_VIEW(view), TRUE);
    gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(view), GTK_WRAP_WORD_CHAR);
    gtk_container_add(GTK_CONTAINER(scroller), view);
    g_buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(view));
    gtk_grid_attach(GTK_GRID(grid), scroller, 0, 6, 2, 1);

    gtk_container_add(GTK_CONTAINER(window), grid);

    Settings settings;
    std::string error;
    if (load_settings(settings, error)) {
        gtk_entry_set_text(GTK_ENTRY(g_server), settings.server.c_str());
        if (!settings.api_key.empty()) gtk_entry_set_text(GTK_ENTRY(g_key), settings.api_key.c_str());
        // 恢复上次勾选的摘要算法
        const std::vector<std::string> algorithms = effective_algorithms(settings.algorithms);
        auto select = [&algorithms](GtkWidget *button, const char *name) {
            const bool on = std::find(algorithms.begin(), algorithms.end(), std::string(name)) != algorithms.end();
            gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(button), on ? TRUE : FALSE);
        };
        select(g_algo_sha1, "sha1");
        select(g_algo_sha256, "sha256");
        select(g_algo_sha384, "sha384");
        select(g_algo_sha512, "sha512");
    } else {
        append_log("读取配置失败：" + error);
    }
    append_log("CertumSigner 1.0 —— 私钥在 Certum 云端，本机只转发摘要。");

    g_signal_connect(browse, "clicked", G_CALLBACK(on_browse), nullptr);
    g_signal_connect(g_sign, "clicked", G_CALLBACK(on_sign), nullptr);
    g_signal_connect(window, "delete-event", G_CALLBACK(on_delete), nullptr);
    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), nullptr);

    gtk_widget_show_all(window);
    gtk_main();
    g_buffer = nullptr;
    return 0;
}

} // namespace cs
