package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestAssetCachePolicy(t *testing.T) {
	const (
		assetKey   = "assets/main-aB_c-d9X.js"
		assetPath  = "/" + assetKey
		assetBody  = "const answer = 42"
		cacheValue = "public, max-age=31536000, immutable"
	)
	files := fstest.MapFS{
		assetKey:                   {Data: []byte(assetBody)},
		"assets/site.css":          {Data: []byte("body {}")},
		assetKey + ".map":          {Data: []byte("{}")},
		"images/logo-aB_c-d9X.svg": {Data: []byte("<svg/>")},
	}
	withStaticFS(t, files)
	saved := staticFiles
	staticFiles = http.FileServer(http.FS(files))
	t.Cleanup(func() { staticFiles = saved })
	handler := Handler()
	indexBody := serveIndexBody(t)
	for _, test := range []struct {
		name, method, requestPath, byteRange string
		status                               int
		cache, body                          string
	}{
		{"versioned asset", http.MethodGet, assetPath, "", http.StatusOK, cacheValue, assetBody},
		{"asset head", http.MethodHead, assetPath, "", http.StatusOK, cacheValue, ""},
		{"asset range", http.MethodGet, assetPath, "bytes=0-2", http.StatusPartialContent, cacheValue, "con"},
		{"unversioned asset", http.MethodGet, "/assets/site.css", "", http.StatusOK, "", "body {}"},
		{"source map", http.MethodGet, assetPath + ".map", "", http.StatusOK, "", "{}"},
		{"public file", http.MethodGet, "/images/logo-aB_c-d9X.svg", "", http.StatusOK, "", "<svg/>"},
		{"missing asset", http.MethodGet, "/assets/missing-aB_c-d9X.js", "", http.StatusOK, "", indexBody},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.requestPath, nil)
			if test.byteRange != "" {
				req.Header.Set("Range", test.byteRange)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != test.status || rec.Header().Get("Cache-Control") != test.cache {
				t.Fatalf("status=%d Cache-Control=%q, want status=%d Cache-Control=%q", rec.Code, rec.Header().Get("Cache-Control"), test.status, test.cache)
			}
			if got := rec.Body.String(); got != test.body {
				t.Fatalf("body=%q, want %q", got, test.body)
			}
		})
	}
}
