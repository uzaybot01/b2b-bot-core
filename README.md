# Uzay Bot

Uzay Bot, Discord.js v14 ile geliştirilmiş; sunucu bazlı kayıt akışı, kişiye özel kayıt odaları ve ses kanalı bağlantısı sağlayan modüler bir Discord botudur. Komutlar `commands/` klasöründen otomatik yüklenir, her sunucunun ayarları `data/settings/<guildId>.json` dosyasında tutulur ve ortak yardımcılar `utils/` altında bulunur.

## İçindekiler

- [Özellikler](#özellikler)
- [Gereksinimler ve kurulum](#gereksinimler-ve-kurulum)
- [Discord uygulama ayarları](#discord-uygulama-ayarları)
- [Komutlar ve parametreler](#komutlar-ve-parametreler)
- [Kayıt akışı](#kayıt-akışı)
- [Ses bağlantısı ve tercihleri](#ses-bağlantısı-ve-tercihleri)
- [Bot profil fotoğrafı](#bot-profil-fotoğrafı)
- [Mimari ve tetiklenme diyagramları](#mimari-ve-tetiklenme-diyagramları)
- [Önerilen kurulum sırası](#önerilen-kurulum-sırası)
- [Ayar dosyası ve sorun giderme](#ayar-dosyası-ve-sorun-giderme)

## Özellikler

- Slash komutlarının bot açılırken `commands/` klasöründen dinamik yüklenmesi ve Discord’a yayımlanması.
- `utils/permissions.js` üzerinden yönetici, kayıt ve log/güvenlik görevlerine göre merkezî RBAC denetimi.
- Slash komutları ve kayıt butonları için kullanıcı başına üç saniyelik ortak cooldown.
- Embed metinleri ve URL seçenekleri için sınırlandırılmış girdi temizleme/doğrulaması.
- Token yoksa güvenli başlangıç hatası; kritik süreç hatalarında loglama ve kontrollü kapatma.
- Sunucuya özel kategori, yetkili rolü, log kanalı ve birden fazla kalıcı ses kanalı ayarı.
- Kayıt talebi için üyeye özel metin kanalı ve yetkili log paneli.
- Kayıt paneli ile oda karşılama mesajının özelleştirilebilmesi.
- Aynı sunucuda farklı kanallara paralel bağlanabilen en fazla dört ses worker'ı; kanal bazlı atama, otomatik yeniden bağlanma ve sunucu bazlı mikrofon/kulaklık tercihleri.
- Yönetici komutuyla botun genel profil fotoğrafını güncelleme.
- Kayıt devralındıktan sonra iki dakikalık geri sayım ve zaman aşımı işlemi.
- Her sunucu için ayrı JSON ayar dosyası ve bot sunucudan ayrıldığında o dosyanın temizlenmesi.
- Yönetim slash komutlarının Discord'da varsayılan olarak kapalı olması; görev rolü görünürlüğünün sunucu Entegrasyon ayarlarında belirlenmesi.

## Gereksinimler ve kurulum

- Node.js **22.12.0 veya üzeri** (`@discordjs/voice` bağımlılığının gereksinimi).
- Discord bot uygulaması ve bot token’ı.
- Botun eklendiği sunucularda uygun kanal ve rol izinleri.

Projeyi indirdikten veya dağıtım ortamına kopyaladıktan sonra kök klasörde:

```sh
npm install
```

Kök dizinde `.env` dosyası oluşturun. Ana bot için:

```dotenv
MASTER_TOKEN=ANA_BOT_TOKENINIZ
```

`MASTER_TOKEN` önceliklidir; geriye dönük uyumluluk için `BOT_TOKEN` ve `DISCORD_TOKEN` adları da kabul edilir. Worker havuzunu kurmak için `.env.example` dosyasındaki yapıya göre worker tokenı ve görevlerini ekleyin. Token’ları kaynak koda veya herkese açık depoya eklemeyin. `.env` Git tarafından yok sayılır.

Botu başlatın:

```sh
node index.js
```

Projedeki `package.json` içinde bir `start` script’i tanımlı değildir; bu nedenle `npm start` yerine `node index.js` kullanın. Ayrıca mevcut `npm test` script’i yalnızca yer tutucu bir komuttur, gerçek bir test paketi çalıştırmaz.

## Discord uygulama ayarları

1. **Uzay Admin** için bir Discord uygulaması/bot oluşturun; tokenını `MASTER_TOKEN` olarak kaydedin.
2. Her worker için ayrı bir Discord uygulaması/bot ve token oluşturun. Her worker'ın `WORKER_<AD>_TOKEN` ve virgülle ayrılmış `WORKER_<AD>_TASKS` değişkenlerini tanımlayın.
3. Ana botu `bot` ve `applications.commands` kapsamlarıyla hedef sunucuya ekleyin. Slash komutları sadece Ana Bot tarafından yayımlanır ve yanıtlanır.
4. Worker botlarını da `bot` kapsamıyla, yalnızca görevlerinin gerektirdiği izinlerle aynı sunucuya ayrıca ekleyin. Worker tokenı tanımlamak botu Discord sunucusuna otomatik eklemez.
5. Ana Bot uygulamasında **Server Members Intent** ve mevcut `!duyuru` tetikleyicisi için **Message Content Intent** seçeneklerini açın. `registration` ve `voice` worker görevleri **Server Members Intent** kullanır; `voice` ayrıca Gateway ses durumu intent’ini ister. Worker uygulamalarında `Message Content Intent` gerekli değildir.
6. Ana Botun ve worker'ların çalışacağı kanallarda ihtiyaç duydukları izinleri verin:
   - Kayıt odaları için kanalları görüntüleme, kanal oluşturma/yönetme, mesaj gönderme ve mesaj geçmişini okuma.
   - Log ve panel kanallarında mesaj gönderme, bağlantı/görsel embed etme ve uygulama komutlarını kullanma.
   - Ses bağlantısı için ses kanalını görüntüleme ve **Connect** izni.
   - Bot profilini değiştirmek için komutu kullanan kişinin sunucu sahibi, **Administrator** veya atanmış özel yönetici rolü olması.

Bot açıldığında slash komutlarını Discord uygulamasına yayımlar. Yönetim komutları Discord'da varsayılan olarak kapalı (`default_member_permissions: "0"`) yayımlanır. Sunucu sahibi veya Administrator, özel görev rollerinin ilgili komutları görüp kullanabilmesi için Discord'da **Sunucu Ayarları → Entegrasyonlar → Uzay Bot → Komut izinleri** bölümünde komutları role göre etkinleştirmelidir. Discord, bu komut izinlerini yerleşik OAuth/Integration yönetim yüzeyinden sunucu yöneticisine uygulatır; bot token'ıyla özel rol bazlı görünürlük/izin ataması yapılamaz. Ayrıca her komut çalıştırıldığında uygulama içindeki RBAC middleware yeniden doğrulama yapar.

### Ana Bot ve Worker Client Pool

```dotenv
MASTER_TOKEN=ANA_BOT_TOKENI

WORKER_REGISTRATION_TOKEN=KAYIT_BOT_TOKENI
WORKER_REGISTRATION_TASKS=registration

WORKER_VOICE_TOKEN=SES_BOT_TOKENI
WORKER_VOICE_TASKS=voice

WORKER_VOICE_2_TOKEN=IKINCI_SES_BOT_TOKENI
WORKER_VOICE_2_TASKS=voice

WORKER_VOICE_3_TOKEN=UCUNCU_SES_BOT_TOKENI
WORKER_VOICE_3_TASKS=voice

WORKER_VOICE_4_TOKEN=DORDUNCU_SES_BOT_TOKENI
WORKER_VOICE_4_TASKS=voice
```

- Ana Bot önce Discord'a bağlanır. Worker oturumları yalnızca Ana Bot `ready` olduktan sonra başlatılır.
- Her `WORKER_<AD>_TOKEN` bir ayrı bot hesabına aittir. Aynı isimle verilen `WORKER_<AD>_TASKS` listesi o istemciye yüklenecek görev eklentilerini belirler. Görev adları virgülle ayrılır; ör. `WORKER_COMBINED_TASKS=voice,registration`.
- Worker istemcileri slash komutlarını yayımlamaz. Panel komutları ve kullanıcı etkileşimlerinin merkezi sahibi Ana Bottur; kayıt worker'ı kayıt odası/karşılama/log panelini oluşturur ve kendi gönderdiği kayıt butonlarını işler.
- Ses görevli worker sayısı en fazla **4** olabilir. Fazla worker tanımlanırsa ad sırasına göre ilk dört `voice` görevi etkinleştirilir; sonraki worker'ların diğer görevleri varsa bu görevler yine yüklenebilir.
- Ses worker havuzu, bağlantıları sunucu ve kanal bazında atar. Aynı sunucudaki her worker aynı anda en fazla bir ses kanalında bulunur; başka bir kanala gelen istek boşta bir worker'a yönlendirilir. Bir worker başka sunucularda da görev alabilir. Kullanılan worker botları hedef sunucuya ayrıca davet edilmiş olmalıdır.
- `/ses-kanal` ile en fazla dört kalıcı kanal kaydedilip her birine ayrı worker bağlanabilir. Kayıt devralma akışında, yetkilinin bulunduğu ses kanalı varsa ona boşta worker atanır; ses kanalında değilse yapılandırılmış ilk kanal kullanılır.
- Her worker, görevi yürüttüğü sunucuya ayrıca davet edilmelidir. Ana Bot hazır değilse veya ilgili sunucuda bulunmuyorsa görev ataması kapatılır; worker etkileşimleri yeni işlem başlatmaz.
- Token/görev havuzu süreç başlatılırken okunur; `.env` değişiklikleri için botu yeniden başlatın.
- `workers/` altındaki her JavaScript görev eklentisi `task` ve `register(client, manager)` dışa aktarır; yalnızca yapılandırmasında atanmış eklentiler worker'a yüklenir. Eklenti, görev fonksiyonları ve gerekli Discord intent’lerini dışa aktarabilir. Yeni bir müzik/chat özelliği için token değişkenlerine ek olarak ör. `workers/music.js` veya `workers/chat.js` eklentisi ve izin/intent tanımı da gerekir; token tek başına özellik kodu oluşturmaz.
- Bilinmeyen/uygulanmamış görev eklentileri başlatılmaz. Worker tokenı yoksa Ana Bot çalışmayı sürdürür, ancak ilgili worker görevi güvenli biçimde reddedilir.

Yeni görev eklentisi `workers/<task>.js` biçiminde eklenir. Görev işlemleri worker-specific modülde bulunur ve Ana Bot `workerManager.runTask(guildId, task, operation, ...args)` ile master/guild/task uygunluğunu kontrol ettikten sonra doğru worker'a yönlendirir:

```js
module.exports = {
    task: 'music',
    intents: [/* yalnızca bu görevin ihtiyaç duyduğu GatewayIntentBits */],
    register(client, manager) {
        // Bu görev worker'ına ait olay dinleyicileri
    },
    play(client, guildId, request) {
        // Yalnızca müzik worker'ına yönlendirilen işlem
    }
};
```

| Worker görevi | Mevcut sorumluluk | Gerekli worker izinleri |
| --- | --- | --- |
| `registration` | Özel kayıt odası, karşılama mesajı ve yetkili log paneli oluşturma; kayıt butonları/zaman aşımı | Kanalları görme/yönetme/oluşturma, mesaj gönderme/geçmişi okuma; Server Members Intent |
| `voice` | Sunucuya ayarlı kalıcı ses kanalına veya kayıt devralan yetkilinin ses kanalına bağlanma | Ses kanalını görme ve Connect; Guild Voice States intent |
| `music`, `chat` ve diğer görevler | Şimdilik eklenti eklenmedi; görev modülü yazılınca havuzdan atanabilir | Eklentinin bildirdiği intent ve izinler |

## Komut envanteri, gruplar ve parametreler

`<parametre>` zorunlu, `[parametre]` isteğe bağlıdır. Kanal, rol ve dosya seçenekleri Discord’un kendi seçim arayüzünden seçilir. Her yönetim işlemi aşağıdaki görev grupları için RBAC middleware tarafından doğrulanır.

| Grup | Komut | Parametreler | Kim kullanabilir? | Açıklama |
| --- | --- | --- | --- | --- |
| Kayıt | `/kayit-ayar` | `<kategori>` (Kategori kanalı), `<rol>` (kayıt yetkilisi rolü) | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Kayıt kategorisi ve kayıt yetkilisi rolünü ayarlar. |
| Kayıt / Panel | `/kayit-talep-butonu` | `<kanal>` (metin kanalı), `[baslik]`, `[aciklama]`, `[buton_yazi]`, `[buton_renk]`, `[gorsel]`, `[oda_baslik]`, `[oda_aciklama]`, `[oda_gorsel]` | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Giriş kanalına kayıt talep butonu ve paneli yollar. Panel ve oda karşılama içeriğini özelleştirir. |
| Ses | `/ses-kanal` | `<kanal>` (standart ses kanalı), `[islem]` (`Ekle ve bağlan` / `Çıkar ve bağlantıyı kes`; varsayılan ekle) | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Boşta bir worker'ı kanala yönlendirir; bu sunucuda en fazla dört kalıcı ses kanalı tutulabilir. |
| Ses | `/ses-durum` | `[durum]` (`Sağır ve susturulmuş` / `Kulaklık ve mikrofon açık`), `[mikrofon_acik]`, `[kulaklik_acik]`; en az biri gerekir | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Botun mikrofon ve kulaklık durumunu birlikte veya ayrı ayrı ayarlar. |
| Log / Güvenlik | `/log-kanal` | `<kanal>` (metin kanalı) | Sunucu sahibi, Administrator, atanmış yönetici rolü veya atanmış log/güvenlik rolü; Discord Integrations içinde ilgili rol için etkinleştirilmiş olmalı | Yeni kayıt taleplerinin yetkili bildiriminin ve devralma panelinin gönderileceği kanalı ayarlar. |
| Log / Güvenlik | `/yetki-ayarla` | `[yonetici_rolu]`, `[log_rolu]`, `[yonetici_rolunu_kaldir]`, `[log_rolunu_kaldir]`; en az bir değişiklik gerekir | Yalnızca sunucu sahibi veya Administrator izni; Discord Integrations içinde Administrator erişimi açık olmalı | Sunucuya özel yönetici ve log/güvenlik rollerini atar ya da kaldırır. |
| Kayıt / Görsel | `/kayit-mesaj-gorseli` | `<logo>` (HTTP/HTTPS URL) | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Yalnızca bu sunucudaki kayıt paneli ve karşılama mesajı için varsayılan görseli kaydeder. |
| Sunucu / Bot ayarları | `/bot-profil` | `[gorsel]` (dosya eki) veya `[url]` (HTTP/HTTPS URL); **yalnızca biri** kullanılmalıdır | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Botun tüm sunucularda görünen genel profil fotoğrafını günceller. Discord değişiklik sıklığını sınırlayabilir. |
| Yardım / Bilgi | `/yardim` | Parametre yok | Tüm üyeler | Komut rehberini gösterir. |

Slash dışı tetikleyici: `!duyuru`, [Duyuru modülü](./commands/duyuru.js) içinde yalnızca modülün aktif olduğunu bildirir; toplu mesaj göndermez. Henüz uygulanmamış bir toplu mesaj slash komutu envantere dahil değildir.

`commands/` klasöründeki her modül `index.js` tarafından yüklenir. Etkin slash komutları: `/kayit-ayar`, `/kayit-talep-butonu`, `/kayit-mesaj-gorseli`, `/ses-kanal`, `/ses-durum`, `/log-kanal`, `/yetki-ayarla`, `/bot-profil` ve `/yardim`. `duyuru.js` slash komutu değildir; `!duyuru` mesaj tetikleyicisidir ve toplu mesaj göndermez.

Komut adlandırma standardı: Slash komutları Discord uyumluluğu için Türkçe sözcüklerin ASCII karşılıklarını kullanan küçük harfli ve tireli `kategori-islev` biçimini izler; örneğin `kayit-talep-butonu` ve `kayit-mesaj-gorseli`. Komut açıklamaları kullanıcıya Türkçe ve işlev odaklı bilgi verir. Komut modülü dosya adları bu adlandırmadan bağımsızdır ve değiştirilmemiştir. `ses-kanal`, `ses-durum`, `log-kanal` ve `yetki-ayarla` görevlerini açıkça belirtir.

### Rol grupları ve yetki matrisi

| Görev grubu | Yetki kaynağı | İzin verilen işlemler |
| --- | --- | --- |
| Sunucu sahibi / Discord Administrator | Discord sunucu sahibi ve `Administrator` izni | Tüm yönetim ve kayıt işlemleri; `/yetki-ayarla` ile görev rollerini yapılandırma. |
| Özel yönetici | `data/settings/<guildId>.json` içindeki `adminRoleId` | `/kayit-ayar`, `/kayit-talep-butonu`, `/kayit-mesaj-gorseli`, `/ses-kanal`, `/ses-durum`, `/bot-profil`; ayrıca log ve kayıt işlemlerinde yönetici yetkisi. Görev rolü atayamaz/kaldıramaz. Discord Integrations içinde ilgili komutlar bu role etkinleştirilmelidir. |
| Kayıt yetkilisi | `/kayit-ayar` ile kaydedilen `roleId` | Kayıt talebini devralma, sonucu başarılı/iptal olarak işaretleme. İlgili buton etkileşimlerinde uygulama içi yetki denetimi yapılır. |
| Log/güvenlik yetkilisi | `/yetki-ayarla` ile kaydedilen `logSecurityRoleId` | `/log-kanal` kanalını yapılandırma. Discord Integrations içinde `/log-kanal` bu role etkinleştirilmelidir. |
| Üye | Genel sunucu üyeliği | Kayıt panelinden talep açma ve kendi özel kayıt odasına erişme. Yönetim komutlarını çalıştıramaz, kayıt sonucunu veremez. |

Administrator ve sunucu sahibi diğer görev rollerini aşan yetkiye sahiptir. `/yetki-ayarla` yalnızca bu iki yerleşik güvenlik seviyesine açıktır; özel yönetici rolü tek başına rol atayamaz. Log/güvenlik için şu an yalnızca `/log-kanal` kanal ayarı mevcuttur; ayrı bir audit-log veya denetim ayarı komutu henüz uygulanmamıştır.

`/yetki-ayarla` içinde yeni rol seçmek ilgili rolü kaydeder. `yonetici_rolunu_kaldir: true` ve `log_rolunu_kaldir: true` seçenekleri rolleri kaldırır; aynı görev için hem rol seçimi hem kaldırma seçeneği gönderilemez. `@everyone` rolü atanamaz. En az bir rolü değiştirmek veya kaldırmak gerekir. Kayıt yetkilisi ayrı bir RBAC rol alanı kullanmaz; `/kayit-ayar` içindeki `rol` seçeneği aynı görev için kullanılmaya devam eder.

Yetki reddedildiğinde bot, işlemi durdurur ve özel (ephemeral) “Yetersiz yetki” embed’i gösterir. `default_member_permissions: "0"` komutları varsayılan olarak kapatır; Discord Integrations üzerinden açılan roller komutları arayüzde görüp çağırabilir. Görünürlük ayarı tek başına güvenlik sınırı sayılmaz: middleware her etkileşimde sunucuya özel ayar dosyasından rolü tekrar denetler.

#### Discord'da rol bazlı komut görünürlüğünü etkinleştirme

Discord'un bot komut izinlerini değiştiren REST API'si bot token'ı ile çalışmaz; endpoint uygulama sahibinin/yoneticisinin OAuth2 Bearer token'ını ve `applications.commands.permissions.update` kapsamını gerektirir. Bu proje hassas kullanıcı OAuth token'ı saklamaz ve izin değişikliklerini otomatik API çağrısıyla yapmaz. Her sunucunun yöneticisi bir defa şu ayarı yapmalıdır:

1. Sunucu Ayarları → **Entegrasyonlar** → bot uygulaması → **Komut izinleri** bölümünü açın.
2. `/kayit-ayar`, `/kayit-talep-butonu`, `/kayit-mesaj-gorseli`, `/ses-kanal`, `/ses-durum` ve `/bot-profil` komutlarını özel yönetici rolüne; `/log-kanal` komutunu log/güvenlik rolüne; `/yetki-ayarla` komutunu Administrator/yönetici rolüne açın.
3. Kayıt yetkililerinin `Kaydı Devral`, `Başarılı` ve `İptal` butonlarını kullanması için gereken rol ataması `/kayit-ayar` ile yapılır; bu butonlara slash-komut görünürlük ayarı uygulanmaz.
4. Üyelerin kayıt talep butonuna erişmesi için genel giriş paneli komut izninden bağımsız olarak açık/erişilebilir kalmalıdır.

Discord istemcisi komutları izin ayarına göre gizleyebilir veya kullanılamaz gösterebilir; kesin güvenlik kontrolü uygulamanın her komutta yaptığı RBAC denetimidir. Discord rol izinleri güncellendikten veya yeni bir rol atandıktan sonra Integrations ekranındaki erişimleri gözden geçirin.

### `/kayit-ayar` seçeneklerinin anlamı

- `kategori` ve `rol` zorunludur.
- `@everyone` rolü kayıt yetkilisi olarak atanamaz.

### `/ses-kanal` ve `/ses-durum` seçeneklerinin anlamı

- `/ses-kanal` içindeki `kanal` zorunludur. `islem` verilmezse kanal kalıcı listeye eklenir ve havuzdaki boşta bir ses worker'ı bağlanır; `Çıkar ve bağlantıyı kes` seçilirse kanal listeden çıkarılır ve ona atanmış worker serbest bırakılır. Sunucu başına dört kalıcı kanal yapılandırılabilir.
- `/ses-durum` içinde en az bir seçenek verilmelidir. `durum` birlikte ayar yapar:
  - `Sağır ve susturulmuş`: `selfDeaf: true`, `selfMute: true`.
  - `Kulaklık ve mikrofon açık`: `selfDeaf: false`, `selfMute: false`.
- `mikrofon_acik` ve `kulaklik_acik` tercihleri ayrı ayrı ayarlar. `true`, ilgili özelliğin açık; `false`, kapalı olmasını ifade eder. `durum` ile birlikte verilirse tekil tercihler kendi değerleri için önceliklidir.
- İlgili tercih verilmezse daha önce kaydedilmiş değer korunur. Hiç tercih kaydedilmemişse varsayılan olarak `selfDeaf: true` ve `selfMute: true` kullanılır.

### `/kayit-talep-butonu` seçeneklerinin anlamı

- `kanal` zorunludur. Diğer seçeneklerin tümü isteğe bağlıdır.
- `buton_renk`: `primary` (mavi), `success` (yeşil), `danger` (kırmızı) veya `secondary` (gri). Varsayılan `primary` rengidir.
- `buton_yazi` verilmezse “Kayıt Talep Et” kullanılır.
- `baslik`, `aciklama` ve `buton_yazi` girilmezse varsayılan metinler kullanılır.
- `gorsel`, panel embed’inin görselidir; girilmezse `/kayit-mesaj-gorseli` ile kaydedilmiş sunucu görseli kullanılır.
- `oda_baslik`, `oda_aciklama` ve `oda_gorsel` kayıt odasında üyeye gösterilen karşılama embed’ini düzenler. Açıklamadaki `{user}` belirteci talebi açan üyenin etiketiyle değiştirilir. Oda görseli belirtilmezse sunucu logosu kullanılır.
- `oda_*` metin ve görsel ayarları sunucu ayarlarına kaydedilir ve sonraki kayıt odalarında kullanılır.

### `/kayit-mesaj-gorseli` ve `/bot-profil` farkı

- `/kayit-mesaj-gorseli`, görsel URL’sini yalnızca komutun çalıştırıldığı sunucu için kaydeder. Kayıt paneli/karşılama görünümünde kullanılır; bot hesabının avatarını değiştirmez.
- `/bot-profil`, bot hesabının genel avatarını günceller. Değişiklik botun bulunduğu tüm sunucularda görünür ve Discord’un profil güncelleme sınırlarına tabidir.
- `/bot-profil` için dosya eki veya URL’den yalnızca biri girilmelidir. URL’nin HTTP veya HTTPS olması gerekir. Discord.js URL görselini API’ye yüklemek üzere işler; yalnızca görsel içerik sağlayan, erişilebilir bir URL kullanın.

### Slash olmayan mesaj tetikleyicisi

`commands/duyuru.js`, `!duyuru` ile başlayan normal mesajlara “Toplu mesaj modülü aktif ve çalışıyor!” yanıtını verir. Bu modül şu anda toplu mesaj göndermez ve `/all-user-message` isimli bir slash komutu tanımlamaz.

## Kayıt akışı

1. Yönetici `/kayit-ayar`, `/log-kanal` ve `/kayit-talep-butonu` komutlarıyla sunucuyu yapılandırır.
2. Üye kayıt panelindeki butona basar.
3. Bot, `@everyone` erişimini kapatılmış ve talep sahibi/yetkili rolü/bot için izinler tanımlanmış özel bir metin kanalı oluşturur.
4. Üyenin odasına yalnızca karşılama embed’i gönderilir.
5. Log kanalına yetkili rolü etiketlenerek kayıt bildirimi ve **Kaydı Devral** butonu gönderilir.
6. Kayıt yetkilisi veya sunucu yöneticisi kaydı devralınca log panelinde **Başarılı** ve **İptal** butonları ile iki dakikalık sayaç görünür. Sonuç butonları da aynı kayıt yetkisi middleware kontrolünden geçer.
7. Başarı veya iptal seçilirse kayıt odası ve ilgili log paneli silinir. İki dakika içinde sonuç seçilmezse işlem zaman aşımıyla iptal edilir; butonlar devre dışı bırakılır ve kullanıcı kayıt odasında (oda bulunamazsa log mesajının kanalında) bilgilendirilir.

Üyeler yeni bir talep açtıktan sonra aynı kullanıcı için iki dakika boyunca tekrar talep açma bekleme süresi de uygulanır. Bu bekleme süresi çalışan bot sürecinin belleğinde ve sunucular arasında kullanıcı ID’si bazında tutulur; bot yeniden başlatıldığında sıfırlanır. Yetkili devraldıktan sonra başlayan iki dakikalık işlem zamanlayıcısından ayrıdır.

## Ses bağlantısı ve tercihleri

Ses ayarları `data/settings/<guildId>.json` dosyasında sunucu başına saklanır. `/ses-kanal` ile dört adede kadar kalıcı kanal tanımlanabilir; bot açılırken her kanal için ayrı worker bağlantısı kurmayı dener. Eski ayarlardaki tekil `voiceChannelId` alanı da geriye dönük olarak okunur. Bağlantı hatalarında ilgili worker/kanal ataması korunur ve yeniden deneme yapılır.

Kayıt devralma akışında yetkilinin bulunduğu ses kanalı hedeflenir ve boşta worker ona yönlendirilir. Yetkili ses kanalında değilse yapılandırılmış ilk kalıcı kanal yedek olarak kullanılır. Aynı sunucuda başka bir kanala gelen bağlantı isteği, o kanalda zaten bir worker yoksa başka bir boşta worker'a atanır. Worker kapasitesi doluysa işlem güvenli biçimde reddedilir; kayıt akışının geri kalanı devam eder.

Örnek dosya `data/settings/SUNUCU_ID.json` içeriği (gerçek ID’ler yerine açıklayıcı yer tutucular kullanılmıştır):

```json
{
  "categoryId": "KAYIT_KATEGORI_ID",
  "roleId": "YETKILI_ROL_ID",
  "adminRoleId": "OZEL_YONETICI_ROL_ID",
  "logSecurityRoleId": "LOG_GUVENLIK_ROL_ID",
  "logChannelId": "LOG_KANALI_ID",
  "voiceChannelIds": ["KALICI_SES_KANALI_1", "KALICI_SES_KANALI_2"],
  "voiceChannelId": "GERIYE_DONUK_ILK_KANAL",
  "voiceSelfDeaf": true,
  "voiceSelfMute": true,
  "customLogo": "https://example.com/sunucu-logo.png",
  "welcomeTitle": "Kayıt odasına hoş geldiniz",
  "welcomeDescription": "Merhaba {user}, yetkili ekibimiz birazdan sizinle ilgilenecek.",
  "welcomeImage": "https://example.com/karsilama.png"
}
```

Bu dosya bot tarafından yönetilir; örnek yapıyı gerçek Discord ID’leriyle doldurup ayarların üstüne yazmayın. Komutlar çalıştırıldıkça `utils/settings.js` ilgili sunucu dosyasını günceller. JSON sözdizimini koruyun ve dağıtım ortamında `data/settings/` dizininin yazılabilir olduğundan emin olun. Dizin ve JSON ayar dosyaları Git tarafından yok sayılır.

Önceki tek dosyalı kurulumdan geçişte kök `settings.json` `{ "<guildId>": { ... } }` biçimindeyse, bot açılırken her sunucunun ayarını bir defa ayrı dosyaya kopyalar. Eski dosya geri dönüş için korunur; var olan sunucu dosyalarının üzerine yazılmaz. `data/settings/.legacy-migration-complete` işaretçisi geçişin tekrar yapılmasını önler.

Bot `guildDelete` olayı aldığında ilgili sabit ses bağlantısı durdurulur ve yalnız o sunucuya ait `<guildId>.json` dosyası silinir. Sunucu tekrar eklenirse kurulum komutlarını yeniden çalıştırın.

## Bot profil fotoğrafı

`/bot-profil` ile gönderilen dosya Discord CDN’deki ek URL’si üzerinden alınır; `url` seçeneğinde ise kullanıcının sağladığı HTTP/HTTPS adresi kullanılır. Komut görsel kaynağını `client.user.setAvatar(url)` metoduna verir. Discord.js bu URL’yi görsel verisi olarak işler ve Discord API’ye avatar güncellemesi gönderir. Başarılı sonuçta komutu kullanan yöneticiye özel bir embed yanıtı verilir; hız sınırı/API hatalarında anlaşılır bir uyarı gösterilir.

Avatar bot hesabı için ortaktır; bu ayar `data/settings/<guildId>.json` içindeki sunucu logosundan bağımsızdır. Sık avatar değişiklikleri Discord tarafından geçici olarak kısıtlanabileceğinden hata alındığında bir süre bekleyip yeniden deneyin.

## Mimari ve tetiklenme diyagramları

### Modüllerin yüklenmesi ve komutların yayımlanması

```text
node index.js
    |
    +--> .env içinden MASTER_TOKEN (veya eski token değişkenini) yükle
    +--> Uzay Admin istemcisini başlat ve Client Pool yöneticisini hazırla
    +--> commands/*.js dosyalarını sırayla yükle
    |       +--> Slash komutlarını client.commands koleksiyonuna ekle
    |       +--> Ana Bot interaction/mesaj dinleyicilerini kaydet
    |
    +--> Uzay Admin Discord'a bağlanır ve ready olur
            +--> WORKER_<AD>_TOKEN/TASKS yapılandırmasını oku
            +--> görev eklentilerine göre worker Client'larını başlat
            +--> yalnızca Ana Botun bulunduğu sunucularda görev ataması yap
            +--> yapılandırılmış her ses kanalı için boşta worker ata (en fazla 4)
            +--> Slash komutlarını yalnızca Ana Bot uygulamasına yayımla
```

### Kayıt talebinin oluşturulması ve sonuçlandırılması

```text
Üye: kayıt panelindeki butona basar
    |
    +--> interactionCreate / kayit_talep_et
    +--> interaction ve yetki kontrolü Uzay Admin'de kalır
    +--> categoryId, roleId ve logChannelId ayarlarını doğrula
    +--> registration görevli Worker'a kayıt işi delege et
            +--> Kullanıcıya özel kayıt metin kanalını oluştur
            |       +--> @everyone: kanalı göremez
            |       +--> Talep sahibi + yetkili rolü + Ana Bot + worker: gerekli izinler
            +--> Üye kanalına özelleştirilmiş karşılama embed'i gönder
            +--> Log kanalına yetkili bildirimi ve worker'ın işleyeceği butonu gönder
            |
            +--> Yetkili: worker mesajındaki kaydı devral
                    +--> voice görevli Worker'a ses bağlantısını delege et
                    +--> "Başarılı" / "İptal" butonlarını ve 2:00 sayacını başlat
                    +--> Sonuç seçilirse kayıt odasını ve log panelini sil
                    +--> Süre dolarsa paneli güncelle, butonları kapat ve kullanıcıyı bilgilendir
```

### Çoklu ses worker dağıtımı ve ses tercihleri

```text
Yönetici: /ses-kanal <kanal> [islem=ekle]
    |
    +--> commands/kayit-sistemi.js kanal seçimini işler
    +--> worker-manager.js sunucu/kanal için boşta voice worker seçer
    +--> seçilen worker yalnızca bu sunucudaki bir ses kanalını sahiplenir
    +--> data/settings/<guildId>.json -> voiceChannelIds listesine ekle (en fazla 4)
    +--> [islem=cikar] seçilen kanalın bağlantısını kes ve worker'ı serbest bırak

Yönetici: /ses-durum [durum] [mikrofon_acik] [kulaklik_acik]
    |
    +--> commands/kayit-sistemi.js ses tercihlerini işler
    +--> utils/settings.js -> voiceSelfDeaf ve voiceSelfMute değerlerini kaydeder
    +--> kayıtlı tüm ses kanalları bağlantıları güncel tercihlerle yenilenir
    |
Yetkili kayıt devralır / ses bağlantısı ister
    +--> yetkilinin bulunduğu kanal belirlenir; orada değilse ilk yapılandırılmış kanal seçilir
    +--> worker-manager.js aynı kanal için önceki atamayı kullanır, başka kanala boşta worker ayırır
    +--> 4 worker da doluysa istek hata ile sonuçlanır, mevcut bağlantılar korunur
    |
Bot hazır, sunucuya eklendi veya uygulama yeniden başlatıldı
    +--> worker-manager.js voiceChannelIds listesindeki her kanal için worker atar
    +--> utils/voice.js bağlantı durumunu worker hesabı + sunucu bazında ayrı tutar
    +--> Guild/kanal/adaptör/Connect iznini doğrular
    +--> joinVoiceChannel({ channelId, guildId, selfDeaf, selfMute, ... })
    +--> Discord voice state kanaldan ayrılma/taşınma gösterirse yeniden bağlan
    +--> VoiceConnection error/Disconnected/Destroyed durumlarında toparlanmayı dene
    +--> toparlanma olmazsa 1s, 2s, 4s ... en fazla 60s aralıklarla yeniden bağlan
    +--> 30 saniyede bir bağlantı durumunu denetle
```

`voiceSelfDeaf: true` botun kulaklığını (self-deaf), `voiceSelfMute: true` ise mikrofonunu (self-mute) kapatır. Bu iki ayar birbirinden bağımsızdır.

`@discordjs/voice`, Discord voice WebSocket heartbeat'lerini ve UDP keep-alive mekanizmasını kendi içinde yönetir; uygulama bunlara ikinci bir paket akışı eklemez. Uygulama katmanı ses durumu olaylarını ve bağlantı durum geçişlerini izler, böylece heartbeat kaybı kütüphanede `Disconnected`/`error` olarak raporlandığında yeniden bağlanma başlatılır. `guildDelete` sırasında watchdog ve yeniden deneme zamanlayıcıları temizlenir.

### Sunucu logosu ve bot avatarı arasındaki akış

```text
/kayit-mesaj-gorseli <görsel URL>
    +--> URL doğrula
    +--> data/settings/<guildId>.json içindeki customLogo alanına yaz
    +--> O sunucunun kayıt paneli/karşılama görsellerinde varsayılan olarak kullan

/bot-profil [gorsel eki] veya [url]
    +--> Yönetici iznini veya sunucuya özel yönetici rolünü denetle
    +--> Girdilerden tam biri verilmelidir
    +--> Ek seçildiyse Discord CDN URL'sini, URL seçildiyse bu URL'yi al
    +--> client.user.setAvatar(url)
    +--> Discord.js görseli Discord API'ye yükler
    +--> Bot hesabının genel avatarı güncellenir (sunucuların tamamında görünür)
```

### Yetki kontrolü (RBAC middleware)

```text
Slash komutu / kayıt yönetim butonu etkileşimi
    |
    +--> utils/permissions.js -> checkPermission(interaction, görev)
            |
            +--> Sunucu sahibi veya Discord Administrator mı?
            |       +--> Evet: izin ver
            |
            +--> Göreve ait rolü data/settings/<guildId>.json'dan al
                    +--> admin: adminRoleId
                    +--> log: logSecurityRoleId
                    +--> registration: /kayit-ayar ile kaydedilen roleId
                    +--> public (/yardim / talep açma): rol gerektirmez
                            |
                            +--> Kullanıcıda rol varsa: devam et
                            +--> Yoksa: işlemi durdur ve özel yetersiz-yetki embed'i gönder
```

## Önerilen kurulum sırası

```text
1. Botu davet et ve gerekli intent/izinleri aç
                 |
                 v
2. Sunucu sahibi/Administrator Discord Integrations ekranında komut izinlerini role göre açsın
                 |
                 v
3. Sunucu sahibi/Administrator isteğe bağlı /yetki-ayarla ile görev rollerini belirlesin
                 |
                 v
4. Yönetici veya özel yönetici /kayit-ayar <kategori> <rol>
   |
   +--> Yönetici /ses-kanal <kanal> [islem]
   +--> Yönetici /ses-durum [durum] [mikrofon_acik] [kulaklik_acik]
                 |
                 v
5. Yönetici veya log yetkilisi /log-kanal <metin-kanalı>
                 |
                 v
6. İsteğe bağlı: yönetici /kayit-mesaj-gorseli <görsel-URL>
                 |
                 v
7. Yönetici /kayit-talep-butonu <giriş-kanalı> [özelleştirmeler]
                 |
                 v
8. Üyeler panel butonuyla talep açar; kayıt yetkilisi log panelinden devralır ve sonuçlandırır
```

| Aşama | Yapılacak işlem | Kontrol |
| --- | --- | --- |
| 1 | Botu sunucuya ekleyin; gerekli intent ve kanal izinlerini verin. | Bot sunucuda çevrim içi görünmeli ve hedef kanalları görebilmeli. |
| 2 | Sunucu sahibi/Administrator Discord Integrations ekranında komutları görev rollerine açsın. | Yönetim komutları diğer üyeler için varsayılan olarak kapalıdır. |
| 3 | Sunucu sahibi/Administrator `/yetki-ayarla` ile yönetici ve log rollerini tanımlasın. | Yetki rolleri yalnızca yerleşik sunucu yöneticileri tarafından atanabilir. |
| 4 | Yönetici veya özel yönetici `/kayit-ayar` ile kategori ve kayıt rolünü seçsin. | Kayıt ayarları ilgili `data/settings/<guildId>.json` dosyasına kaydedilmelidir. |
| 5 | İsteğe bağlı olarak yönetici `/ses-kanal` ile en fazla dört kalıcı kanal eklesin; `/ses-durum` ile tercihleri yapılandırsın. | Her kanal için ayrı bir worker atanmalı; kapasite aşımında mevcut bağlantılar korunmalıdır. |
| 6 | Yönetici veya log yetkilisi `/log-kanal` ile bildirim kanalını seçsin. | Bot log kanalına mesaj gönderebilmelidir. |
| 7 | İsteğe bağlı olarak yönetici `/kayit-mesaj-gorseli` ile kayıt mesajı görselini kaydetsin. | URL HTTP/HTTPS olmalı ve görsel Discord tarafından alınabilmelidir. |
| 8 | Yönetici `/kayit-talep-butonu` ile giriş kanalına kayıt paneli göndersin. | Panel mesajı ve butonu görünmelidir. |
| 9 | Test üyesi panel butonuna bassın; kayıt yetkilisi talebi devralsın. | Özel oda oluşmalı; yalnız kayıt yetkilileri/yöneticiler sonuç seçebilmelidir. |
| 10 | İsteğe bağlı olarak yönetici `/bot-profil` ile avatarı güncellesin. | Komut başarılı yanıt vermeli; avatar tüm sunucularda değişmelidir. |

## Ayar dosyası ve sorun giderme

- **Slash komutu görünmüyor:** Botun `applications.commands` OAuth kapsamıyla davet edildiğini kontrol edin ve botu yeniden başlatın. `index.js`, hazır olduğunda komut listesini Discord’a yayımlar. Global komut güncellemelerinin görünmesi biraz zaman alabilir.
- **Kayıt talebi ayar hatası veriyor:** Önce `/kayit-ayar` ve `/log-kanal` komutlarını çalıştırın. Kategori, rol veya log kanalı sonradan silindiyse doğru değerleri tekrar seçin.
- **Özel rol slash komutunu göremiyor:** Sunucu Ayarları → Entegrasyonlar → bot uygulaması → Komut izinleri bölümünde ilgili komutun role etkinleştirildiğini doğrulayın. Bu Discord ayarı uygulama içindeki `<guildId>.json` RBAC kontrolüne ek olarak gereklidir.
- **Kanal oluşturulamıyor veya log gönderilemiyor:** Botun kategori/kanal üzerinde kanal yönetme, kanalı görme ve mesaj gönderme izinlerini kontrol edin.
- **Bot ses kanalına bağlanamıyor:** `/ses-kanal` ile kanalı ekleyin; `voice` görevli worker'ların sunucuya katıldığını, dört worker sınırının dolu olmadığını ve hedef kanalda `View Channel`/`Connect` izinlerinin bulunduğunu kontrol edin. Kayıt devralmada bot yetkilinin bulunduğu odaya yönlendirilir; bağlantı sorunu kayıt odasının oluşturulmasını engellemez.
- **Ses ayarı değişikliği uygulanmıyor:** `/ses-durum` komutunda ilgili seçeneği açıkça belirtin. Seçilmeyen isteğe bağlı boolean alanı mevcut değeri korur.
- **Sunucu ayarları okunamıyor veya yazılamıyor:** `data/settings/<guildId>.json` dosyasının geçerli JSON olduğunu ve botun `data/settings/` dizinine yazma izni bulunduğunu doğrulayın.
- **Sunucu ayarları beklenmedik biçimde silinmiş:** Bot `guildDelete` olayında ilgili sunucu ayar dosyasını istenen davranışa göre temizler. Sunucuyu yeniden ekledikten sonra `/kayit-ayar`, `/log-kanal` ve diğer yapılandırma komutlarını tekrarlayın.
- **Eski ayarlar yeni konuma taşınmadı:** İlk açılışta kök `settings.json` eski biçimdeyse `data/settings/` altında sunucu başına kopyalanır. İşaretçi `.legacy-migration-complete` bir kez yazılır; eski kaynak dosyayı silmeyin.
- **Profil fotoğrafı güncellenmiyor:** Görselin erişilebilir ve geçerli bir görsel olduğundan emin olun. Discord hız sınırı uyguluyorsa bir süre bekleyin; hata konsola da kaydedilir.
- **Bot yeniden başladığında kayıt zamanlayıcısı kaldığı yerden sürmüyor:** Kayıt sayaçları çalışan bot sürecinde bellekte tutulan etkileşim toplayıcılarıdır; yeniden başlatma sırasında açık sayaçlar kalıcı olarak saklanmaz.
- **`!duyuru` yanıt vermiyor:** Discord Developer Portal’da Message Content Intent’in açık olduğunu ve botun mesajı görebildiğini kontrol edin. Bu tetikleyici toplu mesaj göndermez.

## Güvenlik ve hata yönetimi

### Cooldown ve spam azaltma

Slash komutları ve kayıt paneli/devralma/sonuç butonları, etkileşim işleyicileri çalışmadan önce ortak üç saniyelik kullanıcı cooldown kontrolünden geçer. Süre aşılırsa işlem çalıştırılmaz ve kullanıcıya özel kısa bir bekleme uyarısı verilir. Kayıt talebinin mevcut iki dakikalık iş kuralı cooldown’u ayrıca uygulanmaya devam eder.

Cooldown anahtarları kullanıcı ve sunucuya göre bellekte tutulur; eski girdiler temizlenir ve kayıt sayısı sınırlıdır. Bu mekanizma uygulama düzeyinde spam’i azaltır, ancak ağ seviyesindeki DDoS korumasının veya Discord API rate limit’lerinin yerine geçmez. Sayaçlar bot yeniden başladığında sıfırlanır.

### Girdi doğrulama ve temizleme

- `/kayit-talep-butonu` başlık, açıklama, buton etiketi ve karşılama metinlerinde kontrol/bidi karakterleri temizlenir, metin uzunlukları Discord sınırlarıyla uyumlu tutulur. Metin girdileri kod, SQL veya shell olarak çalıştırılmaz.
- Görsel/logoların URL seçenekleri HTTP/HTTPS doğrulamasından geçirilir; kanal, rol, enum ve boolean seçenekleri Discord’un tipli seçenek API’sinden alınır.
- Üyenin kullanıcı adı kayıt kanal adı yapılmadan önce kontrol karakterleri ve kanal adıyla uyumsuz karakterler yerine güvenli ayraçlarla normalize edilir.
- Panel ve embed mesajlarında kullanıcı metni rol etiketlemesi olarak yorumlanmaz. Kayıt bildirimi mesajında yalnızca hedef kayıt rolünün etiketlenmesine izin verilir.
- Mevcut projede modal formu bulunmamaktadır. Yeni modal eklendiğinde değerler işlenmeden önce `utils/input.js` içindeki `sanitizeText` gibi sınırlandırılmış doğrulamadan geçirilmelidir.
- Temizleme, girdi doğrulamasının yerine geçmez: URL’ler ayrıca doğrulanır; kullanıcının kontrol ettiği değerler komut/shell ya da SQL sorgularına birleştirilmemelidir.

### Token ve kritik hatalar

- Bot token’ı yalnızca `index.js` tarafından `.env` veya çalışma ortamındaki `BOT_TOKEN`/`DISCORD_TOKEN` değişkenlerinden okunur. Token yoksa istemci oturumu başlatılmaz; token değerleri loglanmaz.
- `.env` dosyası `.gitignore` içindedir. Token’ı repoya, README’ye veya hata loglarına eklemeyin. Sızdığı düşünülüyorsa Discord Developer Portal’dan yenileyin.
- Discord login hatası hassas kimlik bilgisi göstermeden loglanır ve süreç başarısız çıkış koduyla sonlandırılır.
- `unhandledRejection` ve `uncaughtException` dinleyicileri kritik hatayı loglar, Discord istemcisini kapatır ve süreci başarısız çıkış koduyla sonlandırır. Yakalanmamış bir istisnadan sonra botu çalışmaya devam ettirmek güvenli olmadığından bu dinleyiciler hatayı gizlemez veya bozulmuş süreçte işlem sürdürmez. Üretim ortamında başarısız çıkış sonrası süreç yöneticisinin botu yeniden başlatmasını yapılandırın.

## Proje yapısı

```text
uzay-bot/
├── commands/
│   ├── bot-profil.js           # /bot-profil genel bot avatarı komutu
│   ├── duyuru.js               # !duyuru mesaj tetikleyicisi
│   ├── kayit-sistemi.js        # Kayıt, ses, log, panel komutları ve buton akışı
│   ├── sunucu-logo.js          # /kayit-mesaj-gorseli sunucuya özel kayıt görseli
│   ├── yardim.js               # Komut rehberi
│   └── yetki-ayarla.js         # Özel yönetici ve log/güvenlik rolleri
├── utils/
│   ├── embeds.js               # Ortak embed oluşturucu
│   ├── input.js                # Metin girdisi normalizasyonu ve uzunluk sınırı
│   ├── interaction-guard.js    # Ortak slash/button cooldown ve komut geçidi
│   ├── permissions.js          # Görev bazlı merkezî yetki kontrolü
│   ├── registration-timeout.js # Kayıt sayaç ve zaman aşımı
│   ├── settings.js             # Sunucu bazlı JSON ayar okuma/yazma ve geçiş
│   ├── validation.js           # Ortak URL doğrulaması
│   ├── voice.js                # Ses bağlantısı ve yeniden bağlanma
│   └── worker-manager.js       # Master/worker istemci havuzu ve görev ataması
├── workers/
│   ├── registration.js         # Kayıt odası, log paneli ve kayıt butonları
│   └── voice.js                # Sabit/üyenin ses kanalına bağlanma görevi
├── .env                        # Ana/worker tokenları (Git'e eklenmemelidir)
├── .env.example                # Token ekleme ve görev yapılandırma örneği
├── .gitignore
├── index.js                    # Ana Bot, dinamik komut ve worker havuzu başlangıcı
├── package.json
├── data/settings/              # Her sunucu için <guildId>.json (Git'e eklenmez)
└── settings.json               # Eski yapıdan geçiş kaynağı; yedek olarak tutulur
```
