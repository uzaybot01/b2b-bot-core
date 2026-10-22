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
- Sunucuya özel kategori, yetkili rolü, log kanalı ve sabit ses kanalı ayarları.
- Kayıt talebi için üyeye özel metin kanalı ve yetkili log paneli.
- Kayıt paneli ile oda karşılama mesajının özelleştirilebilmesi.
- Sabit ses kanalına otomatik bağlanma, bağlantı koptuğunda yeniden bağlanma ve sunucu bazlı mikrofon/kulaklık tercihleri.
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

Kök dizinde `.env` dosyası oluşturun ve aşağıdaki token değişkenlerinden birini tanımlayın:

```dotenv
DISCORD_TOKEN=BOT_TOKENINIZ
```

Kod hem `BOT_TOKEN` hem de `DISCORD_TOKEN` adını kabul eder; `BOT_TOKEN` tanımlıysa önceliklidir. Token’ı kaynak koda veya herkese açık depoya eklemeyin. `.env` Git tarafından yok sayılır.

Botu başlatın:

```sh
node index.js
```

Projedeki `package.json` içinde bir `start` script’i tanımlı değildir; bu nedenle `npm start` yerine `node index.js` kullanın. Ayrıca mevcut `npm test` script’i yalnızca yer tutucu bir komuttur, gerçek bir test paketi çalıştırmaz.

## Discord uygulama ayarları

1. Discord Developer Portal’da uygulama ve bot oluşturun; bot token’ını `.env` dosyasına girin.
2. OAuth2 davet bağlantısında `bot` ve `applications.commands` kapsamlarını seçin.
3. Botu hedef sunucuya davet edin.
4. Developer Portal’da **Server Members Intent** ve **Message Content Intent** seçeneklerini açın. Kod ayrıca sunucu, mesaj ve ses durumu intent’lerini kullanır.
5. Botun çalışacağı kanallarda ihtiyaç duyduğu izinleri verin:
   - Kayıt odaları için kanalları görüntüleme, kanal oluşturma/yönetme, mesaj gönderme ve mesaj geçmişini okuma.
   - Log ve panel kanallarında mesaj gönderme, bağlantı/görsel embed etme ve uygulama komutlarını kullanma.
   - Ses bağlantısı için ses kanalını görüntüleme ve **Connect** izni.
   - Bot profilini değiştirmek için komutu kullanan kişinin sunucu sahibi, **Administrator** veya atanmış özel yönetici rolü olması.

Bot açıldığında slash komutlarını Discord uygulamasına yayımlar. Yönetim komutları Discord'da varsayılan olarak kapalı (`default_member_permissions: "0"`) yayımlanır. Sunucu sahibi veya Administrator, özel görev rollerinin ilgili komutları görüp kullanabilmesi için Discord'da **Sunucu Ayarları → Entegrasyonlar → Uzay Bot → Komut izinleri** bölümünde komutları role göre etkinleştirmelidir. Discord, bu komut izinlerini yerleşik OAuth/Integration yönetim yüzeyinden sunucu yöneticisine uygulatır; bot token'ıyla özel rol bazlı görünürlük/izin ataması yapılamaz. Ayrıca her komut çalıştırıldığında uygulama içindeki RBAC middleware yeniden doğrulama yapar.

## Komutlar ve parametreler

`<parametre>` zorunlu, `[parametre]` isteğe bağlıdır. Kanal, rol ve dosya seçenekleri Discord’un kendi seçim arayüzünden seçilir. Her yönetim işlemi aşağıdaki görev grupları için RBAC middleware tarafından doğrulanır.

| Komut | Parametreler | Kim kullanabilir? | Açıklama |
| --- | --- | --- | --- |
| `/setup` | `<kategori>` (Kategori kanalı), `<rol>` (kayıt yetkilisi rolü), `[ses_kanali]` (standart ses kanalı), `[ses_durumu]`, `[mikrofon_acik]`, `[kulaklik_acik]` | Sunucu sahibi, Administrator veya `/yetki-ayarla` ile atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Kayıt kategorisi ve kayıt rolünü; isteğe bağlı olarak sabit ses kanalını ve ses tercihlerini ayarlar. |
| `/yetki-ayarla` | `[yonetici_rolu]`, `[log_rolu]`, `[yonetici_rolunu_kaldir]`, `[log_rolunu_kaldir]`; en az bir değişiklik gerekir | Yalnızca sunucu sahibi veya Administrator izni; Discord Integrations içinde Administrator erişimi açık olmalı | Sunucuya özel yönetici ve log/güvenlik rollerini atar ya da kaldırır. |
| `/log` | `<kanal>` (metin kanalı) | Sunucu sahibi, Administrator, atanmış yönetici rolü veya atanmış log/güvenlik rolü; Discord Integrations içinde ilgili rol için etkinleştirilmiş olmalı | Yeni kayıt taleplerinin yetkili bildirimi ve devralma panelinin gönderileceği kanalı ayarlar. |
| `/panel` | `<kanal>` (metin kanalı), `[baslik]`, `[aciklama]`, `[buton_yazi]`, `[buton_renk]`, `[gorsel]`, `[oda_baslik]`, `[oda_aciklama]`, `[oda_gorsel]` | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Giriş kanalına kayıt talep paneli yollar. Panel ve oda karşılama içeriğini özelleştirir. |
| `/bot-ayar` | `<logo>` (HTTP/HTTPS URL) | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Yalnızca bu sunucu için varsayılan panel/karşılama logosunu kaydeder. |
| `/bot-profil` | `[gorsel]` (dosya eki) veya `[url]` (HTTP/HTTPS URL); **yalnızca biri** kullanılmalıdır | Sunucu sahibi, Administrator veya atanmış yönetici rolü; Discord Integrations içinde bu komut rol için etkinleştirilmiş olmalı | Botun tüm sunucularda görünen genel profil fotoğrafını günceller. Discord değişiklik sıklığını sınırlayabilir. |
| `/yardim` | Parametre yok | Tüm üyeler | Komut rehberini gösterir. |

### Rol grupları ve yetki matrisi

| Görev grubu | Yetki kaynağı | İzin verilen işlemler |
| --- | --- | --- |
| Sunucu sahibi / Discord Administrator | Discord sunucu sahibi ve `Administrator` izni | Tüm yönetim ve kayıt işlemleri; `/yetki-ayarla` ile görev rollerini yapılandırma. |
| Özel yönetici | `data/settings/<guildId>.json` içindeki `adminRoleId` | `/setup`, `/panel`, `/bot-ayar`, `/bot-profil`; ayrıca log ve kayıt işlemlerinde yönetici yetkisi. Görev rolü atayamaz/kaldıramaz. Discord Integrations içinde ilgili komutlar bu role etkinleştirilmelidir. |
| Kayıt yetkilisi | `/setup` ile kaydedilen `roleId` | Kayıt talebini devralma, sonucu başarılı/iptal olarak işaretleme. İlgili buton etkileşimlerinde uygulama içi yetki denetimi yapılır. |
| Log/güvenlik yetkilisi | `/yetki-ayarla` ile kaydedilen `logSecurityRoleId` | `/log` kanalını yapılandırma. Discord Integrations içinde `/log` bu role etkinleştirilmelidir. |
| Üye | Genel sunucu üyeliği | Kayıt panelinden talep açma ve kendi özel kayıt odasına erişme. Yönetim komutlarını çalıştıramaz, kayıt sonucunu veremez. |

Administrator ve sunucu sahibi diğer görev rollerini aşan yetkiye sahiptir. `/yetki-ayarla` yalnızca bu iki yerleşik güvenlik seviyesine açıktır; özel yönetici rolü tek başına rol atayamaz. Log/güvenlik için şu an yalnızca `/log` kanal ayarı mevcuttur; ayrı bir audit-log veya denetim ayarı komutu henüz uygulanmamıştır.

`/yetki-ayarla` içinde yeni rol seçmek ilgili rolü kaydeder. `yonetici_rolunu_kaldir: true` ve `log_rolunu_kaldir: true` seçenekleri rolleri kaldırır; aynı görev için hem rol seçimi hem kaldırma seçeneği gönderilemez. `@everyone` rolü atanamaz. En az bir rolü değiştirmek veya kaldırmak gerekir. Kayıt yetkilisi ayrı bir RBAC rol alanı kullanmaz; `/setup` içindeki `rol` seçeneği aynı görev için kullanılmaya devam eder.

Yetki reddedildiğinde bot, işlemi durdurur ve özel (ephemeral) “Yetersiz yetki” embed’i gösterir. `default_member_permissions: "0"` komutları varsayılan olarak kapatır; Discord Integrations üzerinden açılan roller komutları arayüzde görüp çağırabilir. Görünürlük ayarı tek başına güvenlik sınırı sayılmaz: middleware her etkileşimde sunucuya özel ayar dosyasından rolü tekrar denetler.

#### Discord'da rol bazlı komut görünürlüğünü etkinleştirme

Discord'un bot komut izinlerini değiştiren REST API'si bot token'ı ile çalışmaz; endpoint uygulama sahibinin/yoneticisinin OAuth2 Bearer token'ını ve `applications.commands.permissions.update` kapsamını gerektirir. Bu proje hassas kullanıcı OAuth token'ı saklamaz ve izin değişikliklerini otomatik API çağrısıyla yapmaz. Her sunucunun yöneticisi bir defa şu ayarı yapmalıdır:

1. Sunucu Ayarları → **Entegrasyonlar** → bot uygulaması → **Komut izinleri** bölümünü açın.
2. `/setup`, `/panel`, `/bot-ayar` ve `/bot-profil` komutlarını özel yönetici rolüne; `/log` komutunu log/güvenlik rolüne; `/yetki-ayarla` komutunu Administrator/yönetici rolüne açın.
3. Kayıt yetkililerinin `Kaydı Devral`, `Başarılı` ve `İptal` butonlarını kullanması için gereken rol ataması `/setup` ile yapılır; bu butonlara slash-komut görünürlük ayarı uygulanmaz.
4. Üyelerin kayıt talep butonuna erişmesi için genel giriş paneli komut izninden bağımsız olarak açık/erişilebilir kalmalıdır.

Discord istemcisi komutları izin ayarına göre gizleyebilir veya kullanılamaz gösterebilir; kesin güvenlik kontrolü uygulamanın her komutta yaptığı RBAC denetimidir. Discord rol izinleri güncellendikten veya yeni bir rol atandıktan sonra Integrations ekranındaki erişimleri gözden geçirin.

### `/setup` seçeneklerinin anlamı

- `kategori` ve `rol` zorunludur.
- `ses_kanali` verilirse botun bu sunucu için kalıcı bağlanacağı kanal kaydedilir.
- `ses_durumu` birlikte ayar yapar:
  - `Sağır ve susturulmuş`: `selfDeaf: true`, `selfMute: true`.
  - `Kulaklık ve mikrofon açık`: `selfDeaf: false`, `selfMute: false`.
- `mikrofon_acik` ve `kulaklik_acik` tercihleri ayrı ayrı ayarlar. `true`, ilgili durumun açık olmasını; `false`, kapalı olmasını ifade eder. Bu seçenekler birlikte `ses_durumu` ile verilirse ayrı seçenekler kendi ilgili değerleri için önceliklidir.
- Ses seçenekleri verilmezse daha önce kaydedilmiş tercih korunur. Hiç tercih kaydedilmemişse varsayılan olarak `selfDeaf: true` ve `selfMute: true` kullanılır.

### `/panel` seçeneklerinin anlamı

- `kanal` zorunludur. Diğer seçeneklerin tümü isteğe bağlıdır.
- `buton_renk`: `primary` (mavi), `success` (yeşil), `danger` (kırmızı) veya `secondary` (gri). Varsayılan `primary` rengidir.
- `buton_yazi` verilmezse “Kayıt Talep Et” kullanılır.
- `baslik`, `aciklama` ve `buton_yazi` girilmezse varsayılan metinler kullanılır.
- `gorsel`, panel embed’inin görselidir; girilmezse `/bot-ayar` ile kaydedilmiş sunucu logosu kullanılır.
- `oda_baslik`, `oda_aciklama` ve `oda_gorsel` kayıt odasında üyeye gösterilen karşılama embed’ini düzenler. Açıklamadaki `{user}` belirteci talebi açan üyenin etiketiyle değiştirilir. Oda görseli belirtilmezse sunucu logosu kullanılır.
- `oda_*` metin ve görsel ayarları sunucu ayarlarına kaydedilir ve sonraki kayıt odalarında kullanılır.

### `/bot-ayar` ve `/bot-profil` farkı

- `/bot-ayar`, görsel URL’sini yalnızca komutun çalıştırıldığı sunucu için kaydeder. Kayıt paneli/karşılama görünümünde kullanılır; bot hesabının avatarını değiştirmez.
- `/bot-profil`, bot hesabının genel avatarını günceller. Değişiklik botun bulunduğu tüm sunucularda görünür ve Discord’un profil güncelleme sınırlarına tabidir.
- `/bot-profil` için dosya eki veya URL’den yalnızca biri girilmelidir. URL’nin HTTP veya HTTPS olması gerekir. Discord.js URL görselini API’ye yüklemek üzere işler; yalnızca görsel içerik sağlayan, erişilebilir bir URL kullanın.

### Slash olmayan mesaj tetikleyicisi

`commands/allusermessage.js`, `!duyuru` ile başlayan normal mesajlara “Toplu mesaj modülü aktif ve çalışıyor!” yanıtını verir. Bu modül şu anda toplu mesaj göndermez ve `/all-user-message` isimli bir slash komutu tanımlamaz.

## Kayıt akışı

1. Yönetici `/setup`, `/log` ve `/panel` komutlarıyla sunucuyu yapılandırır.
2. Üye kayıt panelindeki butona basar.
3. Bot, `@everyone` erişimini kapatılmış ve talep sahibi/yetkili rolü/bot için izinler tanımlanmış özel bir metin kanalı oluşturur.
4. Üyenin odasına yalnızca karşılama embed’i gönderilir.
5. Log kanalına yetkili rolü etiketlenerek kayıt bildirimi ve **Kaydı Devral** butonu gönderilir.
6. Kayıt yetkilisi veya sunucu yöneticisi kaydı devralınca log panelinde **Başarılı** ve **İptal** butonları ile iki dakikalık sayaç görünür. Sonuç butonları da aynı kayıt yetkisi middleware kontrolünden geçer.
7. Başarı veya iptal seçilirse kayıt odası ve ilgili log paneli silinir. İki dakika içinde sonuç seçilmezse işlem zaman aşımıyla iptal edilir; butonlar devre dışı bırakılır ve kullanıcı kayıt odasında (oda bulunamazsa log mesajının kanalında) bilgilendirilir.

Üyeler yeni bir talep açtıktan sonra aynı kullanıcı için iki dakika boyunca tekrar talep açma bekleme süresi de uygulanır. Bu bekleme süresi çalışan bot sürecinin belleğinde ve sunucular arasında kullanıcı ID’si bazında tutulur; bot yeniden başlatıldığında sıfırlanır. Yetkili devraldıktan sonra başlayan iki dakikalık işlem zamanlayıcısından ayrıdır.

## Ses bağlantısı ve tercihleri

Ses ayarları `data/settings/<guildId>.json` dosyasında sunucu başına saklanır. Bot açılırken bağlı sunucuların sabit kanalları için bağlantı kurmayı dener; sunucuya yeni katıldığında da o sunucunun ayarını kontrol eder. Bağlantı hatalarında yeniden deneme yapılır.

Kayıt sürecinde bot önce sunucuda kayıtlı sabit ses kanalını kullanır. Böyle bir ayar yoksa, ilgili etkileşimi başlatan üyenin bulunduğu ses kanalına bağlanmayı dener. Ses kanalına bağlanma izni veya geçerli kanal yoksa kayıt işlemi sürer; kullanıcıya/yetkiliye ses bağlantısının kurulamadığı bildirilebilir.

Örnek dosya `data/settings/SUNUCU_ID.json` içeriği (gerçek ID’ler yerine açıklayıcı yer tutucular kullanılmıştır):

```json
{
  "categoryId": "KAYIT_KATEGORI_ID",
  "roleId": "YETKILI_ROL_ID",
  "adminRoleId": "OZEL_YONETICI_ROL_ID",
  "logSecurityRoleId": "LOG_GUVENLIK_ROL_ID",
  "logChannelId": "LOG_KANALI_ID",
  "voiceChannelId": "SABIT_SES_KANALI_ID",
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
    +--> .env içinden bot token'ı yükle
    +--> utils/settings.js ve utils/voice.js modüllerini istemciye bağla
    +--> commands/*.js dosyalarını sırayla yükle
    |       +--> Slash komutlarını client.commands koleksiyonuna ekle
    |       +--> Etkileşim/mesaj dinleyicilerini kaydet
    |
    +--> Discord istemcisi hazır (ready)
            +--> her sunucunun data/settings/<guildId>.json ayarını yükle
            +--> ayarlı sabit ses kanallarına bağlanmayı dene
            +--> client.commands listesini Discord'a yayımla
```

### Kayıt talebinin oluşturulması ve sonuçlandırılması

```text
Üye: kayıt panelindeki butona basar
    |
    +--> interactionCreate / kayit_talep_et
    +--> categoryId, roleId ve logChannelId ayarlarını doğrula
    +--> Kullanıcıya özel kayıt metin kanalını oluştur
    |       +--> @everyone: kanalı göremez
    |       +--> Talep sahibi + yetkili rolü + bot: gerekli kanal izinleri
    +--> Üye kanalına özelleştirilmiş karşılama embed'i gönder
    +--> Log kanalına yetkili bildirimi ve "Kaydı Devral" butonu gönder
            |
            +--> Yetkili rolü/yönetici: kaydı devral
                    +--> Ses bağlantısını dene
                    +--> "Başarılı" / "İptal" butonlarını ve 2:00 sayacını başlat
                    +--> Sonuç seçilirse kanalı ve log panelini sil
                    +--> Süre dolarsa paneli güncelle, butonları kapat ve kullanıcıyı bilgilendir
```

### Sabit ses kanalı ve ses tercihleri

```text
Yönetici: /setup [ses_kanali] [ses_durumu] [mikrofon_acik] [kulaklik_acik]
    |
    +--> commands/sigun-up.js seçenekleri işler
    +--> utils/settings.js -> updateGuildSettings(guildId, ...)
    +--> data/settings/<guildId>.json -> voiceChannelId, voiceSelfDeaf
                                         ve voiceSelfMute yalnız bu sunucuya yazılır
    +--> Sabit kanal ayarlıysa bağlantı güncellenir/yeniden kurulur
    |
Bot hazır veya yeni sunucuya eklendi
    +--> utils/voice.js ilgili <guildId>.json dosyasından voiceChannelId'yi okur
    +--> Guild/kanal/adaptör/Connect iznini doğrular
    +--> joinVoiceChannel({ channelId, guildId, selfDeaf, selfMute, ... })
    +--> bağlantı koparsa yeniden bağlanmayı dener
```

`voiceSelfDeaf: true` botun kulaklığını (self-deaf), `voiceSelfMute: true` ise mikrofonunu (self-mute) kapatır. Bu iki ayar birbirinden bağımsızdır.

### Sunucu logosu ve bot avatarı arasındaki akış

```text
/bot-ayar <logo URL>
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
                    +--> registration: setup ile kaydedilen roleId
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
4. Yönetici veya özel yönetici /setup <kategori> <rol>
   İsteğe bağlı: ses kanalı ve mikrofon/kulaklık tercihleri
                 |
                 v
5. Yönetici veya log yetkilisi /log <metin-kanalı>
                 |
                 v
6. İsteğe bağlı: yönetici /bot-ayar <logo-URL>
                 |
                 v
7. Yönetici /panel <giriş-kanalı> [özelleştirmeler]
                 |
                 v
8. Üyeler panel butonuyla talep açar; kayıt yetkilisi log panelinden devralır ve sonuçlandırır
```

| Aşama | Yapılacak işlem | Kontrol |
| --- | --- | --- |
| 1 | Botu sunucuya ekleyin; gerekli intent ve kanal izinlerini verin. | Bot sunucuda çevrim içi görünmeli ve hedef kanalları görebilmeli. |
| 2 | Sunucu sahibi/Administrator Discord Integrations ekranında komutları görev rollerine açsın. | Yönetim komutları diğer üyeler için varsayılan olarak kapalıdır. |
| 3 | Sunucu sahibi/Administrator `/yetki-ayarla` ile yönetici ve log rollerini tanımlasın. | Yetki rolleri yalnızca yerleşik sunucu yöneticileri tarafından atanabilir. |
| 4 | Yönetici veya özel yönetici `/setup` ile kategori ve kayıt rolünü seçsin. İsteğe bağlı ses tercihlerini belirlesin. | Ayarlar ilgili `data/settings/<guildId>.json` dosyasına kaydedilmelidir. |
| 5 | Yönetici veya log yetkilisi `/log` ile bildirim kanalını seçsin. | Bot log kanalına mesaj gönderebilmelidir. |
| 6 | İsteğe bağlı olarak yönetici `/bot-ayar` ile sunucu logosunu kaydetsin. | URL HTTP/HTTPS olmalı ve görsel Discord tarafından alınabilmelidir. |
| 7 | Yönetici `/panel` ile giriş kanalına panel göndersin. | Panel mesajı ve butonu görünmelidir. |
| 8 | Test üyesi panel butonuna bassın; kayıt yetkilisi talebi devralsın. | Özel oda oluşmalı; yalnız kayıt yetkilileri/yöneticiler sonuç seçebilmelidir. |
| 9 | İsteğe bağlı olarak yönetici `/bot-profil` ile avatarı güncellesin. | Komut başarılı yanıt vermeli; avatar tüm sunucularda değişmelidir. |

## Ayar dosyası ve sorun giderme

- **Slash komutu görünmüyor:** Botun `applications.commands` OAuth kapsamıyla davet edildiğini kontrol edin ve botu yeniden başlatın. `index.js`, hazır olduğunda komut listesini Discord’a yayımlar. Global komut güncellemelerinin görünmesi biraz zaman alabilir.
- **Kayıt talebi ayar hatası veriyor:** Önce `/setup` ve `/log` komutlarını çalıştırın. Kategori, rol veya log kanalı sonradan silindiyse doğru değerleri tekrar seçin.
- **Özel rol slash komutunu göremiyor:** Sunucu Ayarları → Entegrasyonlar → bot uygulaması → Komut izinleri bölümünde ilgili komutun role etkinleştirildiğini doğrulayın. Bu Discord ayarı uygulama içindeki `<guildId>.json` RBAC kontrolüne ek olarak gereklidir.
- **Kanal oluşturulamıyor veya log gönderilemiyor:** Botun kategori/kanal üzerinde kanal yönetme, kanalı görme ve mesaj gönderme izinlerini kontrol edin.
- **Bot ses kanalına bağlanamıyor:** `/setup` içinde doğru sunucu ses kanalının seçildiğini; kanalın standart ses kanalı olduğunu ve botun `View Channel`/`Connect` izinlerini kontrol edin. Bağlantı sorunları kayıt odasının oluşturulmasını engellemez.
- **Ses ayarı değişikliği uygulanmıyor:** `/setup` komutunda ilgili boolean seçeneğini açıkça seçin. Seçilmeyen isteğe bağlı boolean alanı mevcut değeri korur.
- **Sunucu ayarları okunamıyor veya yazılamıyor:** `data/settings/<guildId>.json` dosyasının geçerli JSON olduğunu ve botun `data/settings/` dizinine yazma izni bulunduğunu doğrulayın.
- **Sunucu ayarları beklenmedik biçimde silinmiş:** Bot `guildDelete` olayında ilgili sunucu ayar dosyasını istenen davranışa göre temizler. Sunucuyu yeniden ekledikten sonra `/setup`, `/log` ve diğer yapılandırma komutlarını tekrarlayın.
- **Eski ayarlar yeni konuma taşınmadı:** İlk açılışta kök `settings.json` eski biçimdeyse `data/settings/` altında sunucu başına kopyalanır. İşaretçi `.legacy-migration-complete` bir kez yazılır; eski kaynak dosyayı silmeyin.
- **Profil fotoğrafı güncellenmiyor:** Görselin erişilebilir ve geçerli bir görsel olduğundan emin olun. Discord hız sınırı uyguluyorsa bir süre bekleyin; hata konsola da kaydedilir.
- **Bot yeniden başladığında kayıt zamanlayıcısı kaldığı yerden sürmüyor:** Kayıt sayaçları çalışan bot sürecinde bellekte tutulan etkileşim toplayıcılarıdır; yeniden başlatma sırasında açık sayaçlar kalıcı olarak saklanmaz.
- **`!duyuru` yanıt vermiyor:** Discord Developer Portal’da Message Content Intent’in açık olduğunu ve botun mesajı görebildiğini kontrol edin. Bu tetikleyici toplu mesaj göndermez.

## Güvenlik ve hata yönetimi

### Cooldown ve spam azaltma

Slash komutları ve kayıt paneli/devralma/sonuç butonları, etkileşim işleyicileri çalışmadan önce ortak üç saniyelik kullanıcı cooldown kontrolünden geçer. Süre aşılırsa işlem çalıştırılmaz ve kullanıcıya özel kısa bir bekleme uyarısı verilir. Kayıt talebinin mevcut iki dakikalık iş kuralı cooldown’u ayrıca uygulanmaya devam eder.

Cooldown anahtarları kullanıcı ve sunucuya göre bellekte tutulur; eski girdiler temizlenir ve kayıt sayısı sınırlıdır. Bu mekanizma uygulama düzeyinde spam’i azaltır, ancak ağ seviyesindeki DDoS korumasının veya Discord API rate limit’lerinin yerine geçmez. Sayaçlar bot yeniden başladığında sıfırlanır.

### Girdi doğrulama ve temizleme

- `/panel` başlık, açıklama, buton etiketi ve karşılama metinlerinde kontrol/bidi karakterleri temizlenir, metin uzunlukları Discord sınırlarıyla uyumlu tutulur. Metin girdileri kod, SQL veya shell olarak çalıştırılmaz.
- Görsel/logoların URL seçenekleri HTTP/HTTPS doğrulamasından geçirilir; kanal, rol, enum ve boolean seçenekleri Discord’un tipli seçenek API’sinden alınır.
- Üyenin kullanıcı adı kayıt kanal adı yapılmadan önce kontrol karakterleri ve kanal adıyla uyumsuz karakterler yerine güvenli ayraçlarla normalize edilir.
- Embed/panel mesajlarında kullanıcı metni rol etiketlemesi olarak yorumlanmaz. Kayıt bildirimi mesajında yalnızca hedef kayıt rolünün etiketlenmesine izin verilir.
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
│   ├── allusermessage.js       # !duyuru mesaj tetikleyicisi
│   ├── bot-ayar.js             # Sunucuya özel logo ayarı
│   ├── bot-profil.js           # Genel bot avatarı komutu
│   ├── sigun-up.js             # Kayıt/setup/log/panel ve buton akışı
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
│   └── voice.js                # Ses bağlantısı ve yeniden bağlanma
├── .env                        # Bot token'ı (Git'e eklenmemelidir)
├── .gitignore
├── index.js                    # İstemci, dinamik modül ve slash komut yöneticisi
├── package.json
├── data/settings/              # Her sunucu için <guildId>.json (Git'e eklenmez)
└── settings.json               # Eski yapıdan geçiş kaynağı; yedek olarak tutulur
```
